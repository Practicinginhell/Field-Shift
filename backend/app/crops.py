"""Crop characteristics used to build and score rotations.

These are general reference values, not local measurements, and the app labels them
that way. Sources:
- Seasonal average crop coefficient (Kc) and rooting depth: estimated from the stage
  values in FAO Irrigation and Drainage Paper 56 (Allen et al., 1998), Tables 12 and 22.
- Growing-season months, frost sensitivity, cover months, market and forage classes:
  general agronomy for temperate North America. Local planting dates, varieties and
  markets differ, which the app reports as information gaps.
Months are northern-hemisphere calendar months (1 = January); the engine shifts them
by six months for southern-hemisphere fields.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Crop:
    key: str
    name: str
    family: str
    """"grass", "legume", "brassica", or "none" (fallow)."""
    season_months: tuple[int, ...]
    """Months the crop uses water (planting to harvest)."""
    cover_months: tuple[int, ...]
    """Months the crop gives the soil real living cover."""
    kc_season: float
    """Seasonal average crop coefficient: crop water use = Kc x reference ET."""
    root_depth_m: float
    nitrogen_fixing: bool
    frost_sensitive: bool
    min_frost_free_days: int
    """For frost-sensitive crops: the shortest frost-free season that suits it."""
    heat_sensitive: bool
    """Yield suffers when days above 35 °C are common during the season."""
    perennial: bool
    market: str
    """General market class: "high", "medium", "low", or "none"."""
    forage: str
    """Forage value: "high", "medium", "low", or "none"."""
    cover_crop_ok: bool
    """A winter cover crop fits after this crop's harvest."""
    is_cover: bool = False


CROPS: dict[str, Crop] = {
    c.key: c
    for c in [
        Crop(
            "corn",
            "Corn (grain)",
            "grass",
            (5, 6, 7, 8, 9),
            (6, 7, 8, 9),
            0.85,
            1.2,
            False,
            True,
            120,
            False,
            False,
            "high",
            "medium",
            True,
        ),
        Crop(
            "soybean",
            "Soybean",
            "legume",
            (5, 6, 7, 8, 9),
            (6, 7, 8, 9),
            0.80,
            0.9,
            True,
            True,
            105,
            False,
            False,
            "high",
            "low",
            True,
        ),
        Crop(
            "sorghum",
            "Sorghum",
            "grass",
            (5, 6, 7, 8, 9),
            (6, 7, 8, 9),
            0.75,
            1.4,
            False,
            True,
            110,
            False,
            False,
            "medium",
            "medium",
            True,
        ),
        Crop(
            "winter_wheat",
            "Winter wheat",
            "grass",
            (10, 11, 3, 4, 5, 6),
            (10, 11, 12, 1, 2, 3, 4, 5, 6),
            0.80,
            1.5,
            False,
            False,
            0,
            True,
            False,
            "high",
            "low",
            False,
        ),
        Crop(
            "spring_wheat",
            "Spring wheat",
            "grass",
            (4, 5, 6, 7),
            (5, 6, 7),
            0.75,
            1.2,
            False,
            False,
            0,
            True,
            False,
            "high",
            "low",
            True,
        ),
        Crop(
            "oats",
            "Oats",
            "grass",
            (4, 5, 6, 7),
            (5, 6, 7),
            0.75,
            1.0,
            False,
            False,
            0,
            True,
            False,
            "medium",
            "medium",
            True,
        ),
        Crop(
            "barley",
            "Barley",
            "grass",
            (4, 5, 6, 7),
            (5, 6, 7),
            0.75,
            1.0,
            False,
            False,
            0,
            True,
            False,
            "medium",
            "medium",
            True,
        ),
        Crop(
            "canola",
            "Canola",
            "brassica",
            (4, 5, 6, 7, 8),
            (5, 6, 7, 8),
            0.75,
            1.0,
            False,
            False,
            0,
            True,
            False,
            "medium",
            "low",
            True,
        ),
        Crop(
            "field_pea",
            "Field pea",
            "legume",
            (4, 5, 6, 7),
            (5, 6, 7),
            0.75,
            0.8,
            True,
            False,
            0,
            True,
            False,
            "medium",
            "medium",
            True,
        ),
        Crop(
            "alfalfa",
            "Alfalfa",
            "legume",
            (4, 5, 6, 7, 8, 9, 10),
            tuple(range(1, 13)),
            0.90,
            1.5,
            True,
            False,
            0,
            False,
            True,
            "medium",
            "high",
            False,
        ),
        Crop(
            "fallow",
            "Fallow (no crop)",
            "none",
            (),
            (),
            0.0,
            0.0,
            False,
            False,
            0,
            False,
            False,
            "none",
            "none",
            False,
        ),
    ]
}

# Winter cover crop added after a main crop's harvest. Not a cash crop.
COVER_RYE = Crop(
    "rye_cover",
    "Cereal rye cover crop",
    "grass",
    (10, 11, 3, 4),
    (10, 11, 12, 1, 2, 3, 4),
    0.50,
    1.0,
    False,
    False,
    0,
    False,
    False,
    "none",
    "low",
    False,
    is_cover=True,
)

# Names in the USDA Cropland Data Layer that map to a crop in CROPS.
CDL_TO_CROP: dict[str, str] = {
    "Corn": "corn",
    "Soybeans": "soybean",
    "Sorghum": "sorghum",
    "Winter Wheat": "winter_wheat",
    "Spring Wheat": "spring_wheat",
    "Durum Wheat": "spring_wheat",
    "Oats": "oats",
    "Barley": "barley",
    "Canola": "canola",
    "Peas": "field_pea",
    "Alfalfa": "alfalfa",
    "Fallow/Idle Cropland": "fallow",
}

# Labels in the AAFC Annual Crop Inventory (Canada) that map to a crop in CROPS.
# "Wheat" (unspecified) and "Pasture/forages" are left out: the farmer picks.
ACI_TO_CROP: dict[str, str] = {
    "Corn for grain": "corn",
    "Soybeans": "soybean",
    "Sorghum": "sorghum",
    "Winter wheat": "winter_wheat",
    "Spring wheat": "spring_wheat",
    "Oats": "oats",
    "Barley": "barley",
    "Canola/rapeseed": "canola",
    "Peas": "field_pea",
    "Fallow": "fallow",
}
