"""Train and compare crop classifiers on HLS greenness curves (offline step).

Reads data/crops/samples.npz (`tools/crop_samples.py`): one row per field-interior
pixel and year, NDVI in 36 ten-day bins, labelled by AAFC's crop map.

Honest split. The test set is **new years in new places**: 2023–2024 pixels in 3 km
blocks that no training row comes from, used once. The model is chosen by
**leave-one-season-out cross-validation** on 2019–2022: each approach is validated four
times, each time on a season (and blocks) it never trained on, because a new season's
weather is what breaks crop models. Then each approach is retrained on all of
2019–2022 and tested. (Two earlier runs used one validation split; see
docs/project_page.md for all three runs.)

Three approaches, scored the same way:

- **Nearest typical curve**: each crop's average season curve; the closest one wins.
- **XGBoost**: gradient-boosted trees on the 36 bins.
- **Temporal CNN**: a small 1D convolutional network (torch) on the curve and its
  clear-view mask.

Then predicts the Ottawa example field's crop for each year (that field and 2 km
around it were never in training) and writes the result into
app/observed_data/ottawa.json. Run after `tools.build_observed` and `tools/si_flags.py`
(they rewrite that file):

    cd backend && PYTHONPATH=. ~/miniconda3/envs/nasa-si/bin/python tools/train_crop_model.py
"""

import json
import time
from pathlib import Path

# xgboost before torch: both bundle OpenMP on macOS. torch first makes xgboost segfault
# (exit 139), and torch's multi-threaded CPU ops deadlock after xgboost has run unless
# torch keeps to one thread (`torch.set_num_threads(1)` in main). Seen 2026-11-14.
from xgboost import XGBClassifier  # isort: skip

import numpy as np
import torch
from sklearn.metrics import confusion_matrix, f1_score
from torch import nn

ROOT = Path(__file__).resolve().parents[2]
SAMPLES = ROOT / "data" / "crops" / "samples.npz"
RESULTS = ROOT / "data" / "crops" / "results.json"
OBSERVED = Path(__file__).resolve().parents[1] / "app" / "observed_data" / "ottawa.json"
TEST_YEARS = (2023, 2024)
BLOCK_PX = 100  # 3 km
TEST_BLOCK_SHARE = 0.25
VAL_BLOCK_SHARE = 0.25
SEASON = slice(9, 31)  # bins Apr 1 → Oct 27: where crops differ
MIN_CLEAR_IN_SEASON = 5
LABELS = {
    "corn": "Corn",
    "soybean": "Soybeans",
    "winter_wheat": "Winter wheat",
    "spring_cereal": "Spring cereal (barley, oats or spring wheat)",
    "hay_pasture": "Hay or pasture",
}
# AAFC codes of the demo field's mapped crop → class (tools/crop_samples.py CLASSES).
ACI_LABEL_TO_CLASS = {
    "Corn for grain": "corn",
    "Soybeans": "soybean",
    "Winter wheat": "winter_wheat",
    "Barley": "spring_cereal",
    "Oats": "spring_cereal",
    "Spring wheat": "spring_cereal",
    "Pasture/forages": "hay_pasture",
}
SEED = 0


def interpolate_rows(X: np.ndarray) -> np.ndarray:
    """Fill NaN bins linearly along time; ends take the nearest clear value."""
    out = X.copy()
    t = np.arange(X.shape[1])
    for i, row in enumerate(X):
        ok = np.isfinite(row)
        if ok.any():
            out[i] = np.interp(t, t[ok], row[ok])
        else:
            out[i] = 0.0
    return out


def scores(y_true, y_pred, n_classes: int) -> dict:
    return {
        "accuracy": round(float((y_true == y_pred).mean()), 3),
        "macro_f1": round(float(f1_score(y_true, y_pred, average="macro")), 3),
        "per_class_f1": [
            round(float(v), 3)
            for v in f1_score(y_true, y_pred, average=None, labels=range(n_classes))
        ],
        "confusion": confusion_matrix(y_true, y_pred, labels=range(n_classes)).tolist(),
    }


class NearestCurve:
    def fit(self, X, y):
        self.means = np.stack([X[y == k][:, SEASON].mean(0) for k in range(y.max() + 1)])
        return self

    def predict_proba(self, X):
        d = ((X[:, None, SEASON] - self.means[None]) ** 2).sum(-1)
        p = np.exp(-(d - d.min(1, keepdims=True)) / 0.05)
        return p / p.sum(1, keepdims=True)


class TemporalCNN(nn.Module):
    def __init__(self, n_classes: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv1d(2, 32, 5, padding=2),
            nn.BatchNorm1d(32),
            nn.ReLU(),
            nn.Conv1d(32, 64, 5, padding=2),
            nn.BatchNorm1d(64),
            nn.ReLU(),
            nn.Conv1d(64, 64, 3, padding=1),
            nn.BatchNorm1d(64),
            nn.ReLU(),
        )
        self.head = nn.Sequential(nn.Dropout(0.3), nn.Linear(128, n_classes))

    def forward(self, x):
        h = self.net(x)
        return self.head(torch.cat([h.mean(-1), h.amax(-1)], 1))


def cnn_input(X_filled: np.ndarray, X_raw: np.ndarray) -> torch.Tensor:
    return torch.tensor(np.stack([X_filled, np.isfinite(X_raw)], 1), dtype=torch.float32)


def train_cnn(Xf, Xr, y, n_classes, device, val=None, epochs=None):
    """Early-stops on `val` (Xf, Xr, y) if given, else trains for `epochs`.
    Returns (model, epochs used)."""
    torch.manual_seed(SEED)
    model = TemporalCNN(n_classes).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-3)
    counts = np.bincount(y, minlength=n_classes)
    weight = torch.tensor(counts.sum() / (n_classes * counts), dtype=torch.float32, device=device)
    loss_fn = nn.CrossEntropyLoss(weight=weight)
    xt, yt = cnn_input(Xf, Xr), torch.tensor(y)
    xv = cnn_input(val[0], val[1]).to(device) if val else None
    best, best_state, best_epoch, patience = -1.0, None, 0, 0
    gen = torch.Generator().manual_seed(SEED)
    for epoch in range(1, (epochs or 80) + 1):
        model.train()
        order = torch.randperm(len(yt), generator=gen)
        for i in range(0, len(order), 256):
            b = order[i : i + 256]
            xb = xt[b].clone()
            shift = int(torch.randint(-1, 2, (1,), generator=gen))
            xb = torch.roll(xb, shift, dims=-1)  # planting a week early or late
            xb[:, 0] += 0.02 * torch.randn(xb[:, 0].shape, generator=gen)
            opt.zero_grad()
            loss_fn(model(xb.to(device)), yt[b].to(device)).backward()
            opt.step()
        if xv is None:
            continue
        model.eval()
        with torch.no_grad():
            pred = model(xv).argmax(1).cpu().numpy()
        f1 = f1_score(val[2], pred, average="macro")
        if f1 > best:
            best, best_epoch, patience = f1, epoch, 0
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
        else:
            patience += 1
            if patience >= 12:
                break
    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()
    return model, best_epoch if val else epochs


def cnn_proba(model, Xf, Xr, device) -> np.ndarray:
    with torch.no_grad():
        return torch.softmax(model(cnn_input(Xf, Xr).to(device)), 1).cpu().numpy()


def balanced_weights(y: np.ndarray, k: int) -> np.ndarray:
    counts = np.bincount(y, minlength=k)
    return (counts.sum() / (k * np.maximum(counts, 1)))[y]


def fit(name: str, data: tuple, k: int, device: str, val: tuple | None, budget: int | None):
    """Train one approach. With `val`, early-stop on it; else use `budget` (trees or
    epochs, from cross-validation). Returns (predict_proba(Xf, Xr), budget used, model)."""
    Xf, Xr, y = data
    if name == "Nearest typical curve":
        m = NearestCurve().fit(Xf, y)
        return (lambda a, b: m.predict_proba(a)), None, m
    if name == "XGBoost":
        params = dict(
            max_depth=6,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            tree_method="hist",
            eval_metric="mlogloss",
            random_state=SEED,
        )
        if val:
            m = XGBClassifier(n_estimators=600, early_stopping_rounds=40, **params)
            m.fit(
                Xf,
                y,
                sample_weight=balanced_weights(y, k),
                eval_set=[(val[0], val[2])],
                verbose=False,
            )
            used = m.best_iteration + 1
        else:
            m = XGBClassifier(n_estimators=budget, **params)
            m.fit(Xf, y, sample_weight=balanced_weights(y, k))
            used = budget
        return (lambda a, b: m.predict_proba(a)), used, m
    m, used = train_cnn(Xf, Xr, y, k, device, val=val, epochs=budget)
    return (lambda a, b: cnn_proba(m, a, b, device)), used, m


APPROACHES = ["Nearest typical curve", "XGBoost", "Temporal CNN"]


def main() -> None:
    d = np.load(SAMPLES)
    classes = [str(c) for c in d["classes"]]
    k = len(classes)
    X_raw, y, year = d["X"], d["label"].astype(int), d["year"]
    keep = np.isfinite(X_raw[:, SEASON]).sum(1) >= MIN_CLEAR_IN_SEASON
    print(f"{keep.sum()} of {keep.size} rows have ≥{MIN_CLEAR_IN_SEASON} clear views in season")
    X_raw, y, year = X_raw[keep], y[keep], year[keep]
    row, col = d["row"][keep], d["col"][keep]
    X = interpolate_rows(X_raw)

    rng = np.random.default_rng(SEED)
    block = (row // BLOCK_PX) * 1000 + col // BLOCK_PX
    shuffled = rng.permutation(np.unique(block))
    n_test = int(len(shuffled) * TEST_BLOCK_SHARE)
    n_val = int(len(shuffled) * VAL_BLOCK_SHARE)
    in_test_block = np.isin(block, shuffled[:n_test])
    in_val_block = np.isin(block, shuffled[n_test : n_test + n_val])
    pool = ~np.isin(year, TEST_YEARS) & ~in_test_block  # everything training may touch
    test = np.isin(year, TEST_YEARS) & in_test_block
    cv_years = sorted(int(v) for v in np.unique(year[pool]))
    print(f"training pool {pool.sum()} ({cv_years}), test {test.sum()} (new years, new places)")

    torch.set_num_threads(1)  # see the import note: OpenMP clash with xgboost
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    rows = lambda m: (X[m], X_raw[m], y[m])  # noqa: E731

    # 1. Leave one season out: validate each approach on a year (and blocks) it never saw.
    results: dict[str, dict] = {}
    for name in APPROACHES:
        t, truth, preds, budgets, per_year = time.time(), [], [], [], {}
        for v in cv_years:
            tr = pool & (year != v) & ~in_val_block
            va = pool & (year == v) & in_val_block
            proba, used, _ = fit(name, rows(tr), k, device, val=rows(va), budget=None)
            pred = proba(X[va], X_raw[va]).argmax(1)
            truth.append(y[va])
            preds.append(pred)
            per_year[v] = round(float(f1_score(y[va], pred, average="macro")), 3)
            if used:
                budgets.append(used)
        cv = scores(np.concatenate(truth), np.concatenate(preds), k)
        results[name] = {
            "cv": cv,
            "cv_per_year": per_year,
            "budget": round(float(np.mean(budgets))) if budgets else None,
        }
        print(
            f"{name:<22} CV macro-F1 {cv['macro_f1']:.3f} (by held-out year {per_year}) "
            f"in {time.time() - t:.0f}s"
        )
    chosen = max(results, key=lambda n: results[n]["cv"]["macro_f1"])
    print(f"chosen by cross-validation: {chosen}")

    # 2. Retrain every approach on the whole pool; test once on new years, new places.
    final = {}
    for name in APPROACHES:
        proba, _, model = fit(name, rows(pool), k, device, val=None, budget=results[name]["budget"])
        final[name] = (proba, model)
        results[name]["test"] = scores(y[test], proba(X[test], X_raw[test]).argmax(1), k)
        r = results[name]["test"]
        print(
            f"{name:<22} TEST acc {r['accuracy']:.3f} macro-F1 {r['macro_f1']:.3f}  "
            f"per class {dict(zip(classes, r['per_class_f1'], strict=True))}"
        )

    xgb = final["XGBoost"][1]
    gain = xgb.get_booster().get_score(importance_type="gain")
    top_bins = [b for _, b in sorted(((v, int(f[1:])) for f, v in gain.items()), reverse=True)]
    top_days = [b * 10 + 1 for b in top_bins[:5]]
    print("XGBoost's most telling ten-day bins (day of year):", top_days)

    # 3. The Ottawa example field: never in training (2 km around it left out).
    demo_raw, demo_years = d["demo_X"], [int(v) for v in d["demo_years"]]
    demo_proba = final[chosen][0](interpolate_rows(demo_raw), demo_raw)
    field = json.loads(OBSERVED.read_text())
    for y_obj in field["years"]:
        if y_obj["year"] not in demo_years:
            continue
        i = demo_years.index(y_obj["year"])
        p, best = demo_proba[i], int(demo_proba[i].argmax())
        seen = int(np.isfinite(demo_raw[i, SEASON]).sum()) >= MIN_CLEAR_IN_SEASON
        mapped = ACI_LABEL_TO_CLASS.get(y_obj.get("crop_label") or "")
        y_obj["model_crop"] = classes[best] if seen else None
        y_obj["model_crop_label"] = LABELS[classes[best]] if seen else None
        y_obj["model_confidence"] = round(float(p[best]), 3) if seen else None
        y_obj["model_agrees"] = None if mapped is None or not seen else mapped == classes[best]
        print(
            f"  {y_obj['year']}: map says {y_obj.get('crop_label')}, model says "
            f"{y_obj['model_crop_label']} ({y_obj['model_confidence']})"
        )
    field["crop_model"] = {
        "chosen": chosen,
        "classes": [LABELS[c] for c in classes],
        "methods": [
            {
                "name": name,
                "accuracy": r["test"]["accuracy"],
                "macro_f1": r["test"]["macro_f1"],
                "per_class_f1": r["test"]["per_class_f1"],
            }
            for name, r in results.items()
        ],
        "n_train": int(pool.sum()),
        "n_test": int(test.sum()),
        "test_note": (
            "Chosen by leave-one-season-out cross-validation on 2019–2022, then tested "
            "once on 2023–2024 in 3 km blocks never used for training, eastern Ontario "
            "(HLS tile T18TVR). Labels are AAFC's crop map, itself a model's output."
        ),
        "telling_days": top_days,
    }
    OBSERVED.write_text(json.dumps(field, indent=1))
    RESULTS.write_text(
        json.dumps({"classes": classes, "chosen": chosen, "results": results}, indent=1)
    )
    print(f"wrote {OBSERVED.name} and {RESULTS.name}")


if __name__ == "__main__":
    main()
