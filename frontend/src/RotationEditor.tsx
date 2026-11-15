import type { CropOption, RotationYear } from "./types";

interface Props {
  crops: CropOption[];
  rotation: RotationYear[];
  onChange: (rotation: RotationYear[]) => void;
}

export default function RotationEditor({ crops, rotation, onChange }: Props) {
  const coverOk = (key: string) => crops.find((c) => c.key === key)?.cover_crop_ok ?? false;

  const update = (index: number, change: Partial<RotationYear>) =>
    onChange(
      rotation.map((year, i) => {
        if (i !== index) return year;
        const next = { ...year, ...change };
        return { ...next, cover: next.cover && coverOk(next.crop) };
      }),
    );

  return (
    <div className="rotation-editor">
      <ol>
        {rotation.map((year, i) => (
          <li key={i}>
            <label className="rotation-year-field">
              <span className="rotation-year-num">
                Year {i + 1}
                <span className="visually-hidden"> crop</span>
              </span>
              <select
                value={year.crop}
                aria-invalid={year.crop === "" || undefined}
                onChange={(e) => update(i, { crop: e.target.value })}
              >
                {year.crop === "" && (
                  <option value="" disabled>
                    Unknown: choose what you grew
                  </option>
                )}
                {crops.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="cover">
              <input
                type="checkbox"
                checked={year.cover}
                disabled={!coverOk(year.crop)}
                onChange={(e) => update(i, { cover: e.target.checked })}
              />
              winter cover crop
            </label>
            {rotation.length > 1 && (
              <button
                type="button"
                className="link"
                aria-label={`Remove year ${i + 1}`}
                onClick={() => onChange(rotation.filter((_, j) => j !== i))}
              >
                remove
              </button>
            )}
          </li>
        ))}
      </ol>
      {rotation.some((y) => y.crop !== "" && !coverOk(y.crop)) && (
        <p className="hint">
          Greyed-out cover crop: winter wheat and alfalfa already cover the soil over winter, and a fallow year is left
          unplanted.
        </p>
      )}
      {rotation.length < 8 && (
        <button type="button" className="secondary" onClick={() => onChange([...rotation, { crop: rotation[rotation.length - 1].crop, cover: false }])}>
          Add a year
        </button>
      )}
    </div>
  );
}
