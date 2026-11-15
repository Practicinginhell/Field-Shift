"""French for every sentence the API writes, applied to a finished English answer.

The rules engine writes English. With `language: "fr"`, `translate_response` turns each
sentence into Canadian French: exact sentences through a table, sentences with numbers
or crop names through patterns, and the values inside them (crop names, months, dates,
decimal commas) through `_val`. A sentence no rule knows stays in English and is
returned, so tests can prove nothing is left behind. Proper names of datasets and
publications are not translated.
"""

import re

from app.models import AnalyzeResponse, ObservedField

# ------------------------------------------------------------------ words and values

CROP_FR = {
    "Spring cereal (barley, oats or spring wheat)": (
        "Céréale de printemps (orge, avoine ou blé de printemps)"
    ),
    "Fallow (no crop)": "Jachère (sans culture)",
    "Corn (grain)": "Maïs-grain",
    "Corn for grain": "Maïs-grain",
    "Winter rye cover": "Couvert de seigle d'automne",
    "Hay or pasture": "Foin ou pâturage",
    "Winter wheat": "Blé d'automne",
    "Spring wheat": "Blé de printemps",
    "Field pea": "Pois de grande culture",
    "Soybeans": "Soya",
    "Soybean": "Soya",
    "Sorghum": "Sorgho",
    "Alfalfa": "Luzerne",
    "Canola": "Canola",
    "Fallow": "Jachère",
    "Barley": "Orge",
    "Corn": "Maïs",
    "Oats": "Avoine",
}
# Lower-case forms, as in "can lose yield" sentences: "corn (grain)" → "maïs-grain".
CROP_FR |= {k.lower(): v[0].lower() + v[1:] for k, v in list(CROP_FR.items())}

MONTH_FR = {
    "Jan": "janv.",
    "Feb": "févr.",
    "Mar": "mars",
    "Apr": "avr.",
    "May": "mai",
    "Jun": "juin",
    "Jul": "juil.",
    "Aug": "août",
    "Sep": "sept.",
    "Oct": "oct.",
    "Nov": "nov.",
    "Dec": "déc.",
}

TEXTURE_FR = {
    "Silty clay loam": "Loam limono-argileux",
    "Sandy clay loam": "Loam sablo-argileux",
    "Sandy clay": "Argile sableuse",
    "Silty clay": "Argile limoneuse",
    "Clay loam": "Loam argileux",
    "Sandy loam": "Loam sableux",
    "Loamy sand": "Sable loameux",
    "Silt loam": "Loam limoneux",
    "Loam": "Loam",
    "Clay": "Argile",
    "Sand": "Sable",
    "Silt": "Limon",
}

WORD_FR = {
    # The farmer's goals, as named in "Suggested because you care about ..."
    "adding organic matter": "ajouter de la matière organique",
    "forage for livestock": "produire du fourrage",
    "breaking pest cycles": "briser les cycles des ravageurs",
    "market suitability": "de bons débouchés",
    "reducing erosion": "réduire l'érosion",
    "fixing nitrogen": "fixer l'azote",
    "saving water": "économiser l'eau",
    # Weather change and soil bits
    "wetter": "humides",
    "drier": "sèches",
    "warmer": "chauds",
    "cooler": "frais",
    "mapped, no properties listed": "cartographié, sans propriétés",
    "organic matter": "matière organique",
    "water-holding": "réserve en eau",
    "slope": "pente",
    "no months": "aucun mois",
    # Satellite record
    "surface soil moisture": "humidité du sol en surface",
    "Field average": "Moyenne du champ",
    "greenness": "verdure",
}

_CROP_RE = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in sorted(CROP_FR, key=len, reverse=True)) + r")(?![\w'])"
)
_TEXTURE_RE = re.compile(r"\b(" + "|".join(re.escape(k) for k in TEXTURE_FR) + r")\b")
_WORD_RE = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in sorted(WORD_FR, key=len, reverse=True)) + r")\b"
)
_MONTHS = "|".join(MONTH_FR)
_DATE_RE = re.compile(rf"\b({_MONTHS}) (\d{{1,2}})\b")
_MONTH_RE = re.compile(rf"\b({_MONTHS})\b")


def _val(text: str) -> str:
    """Translate the values inside a sentence: dates, months, crops, words, numbers."""
    t = _DATE_RE.sub(lambda m: f"{int(m.group(2))} {MONTH_FR[m.group(1)]}", text)
    t = _MONTH_RE.sub(lambda m: MONTH_FR[m.group(1)], t)
    t = _CROP_RE.sub(lambda m: CROP_FR[m.group(1)], t)
    t = _TEXTURE_RE.sub(lambda m: TEXTURE_FR[m.group(1)], t)
    t = _WORD_RE.sub(lambda m: WORD_FR[m.group(1)], t)
    t = re.sub(r"\b1 days?\b", "1 jour", t)
    t = re.sub(r"\b(\d+) days\b", r"\1 jours", t)
    t = re.sub(r"\b1 more\b", "1 autre", t)
    t = re.sub(r"\b(\d+) more\b", r"\1 autres", t)
    t = t.replace(" and ", " et ")
    t = re.sub(r"(\d)%", r"\1 %", t)
    # Decimal comma, but not in names like "TimesFM 2.5" or versions like "v6.1".
    t = re.sub(r"(?<!FM )(?<![vV\d.])(\d+)\.(\d+)", r"\1,\2", t)
    return t


# ------------------------------------------------------------------------ sentences

EXACT = {
    # Why
    "This is your current rotation.": "C'est votre rotation actuelle.",
    "The other options are compared with it.": "Les autres options lui sont comparées.",
    "Suggested as a different direction.": "Suggérée comme une autre direction.",
    "It does not beat your current rotation on the goals you rated highest.": (
        "Elle ne bat pas votre rotation actuelle sur les objectifs que vous jugez les plus "
        "importants."
    ),
    "Adds winter rye cover to your current rotation.": (
        "Ajoute un couvert de seigle d'automne à votre rotation actuelle."
    ),
    # Benefits and trade-offs
    "Grows more feed for livestock (hay, grazing or silage).": (
        "Produit plus d'aliments pour le bétail (foin, pâturage ou ensilage)."
    ),
    "Keeps more years in crops with strong general markets.": (
        "Garde plus d'années en cultures aux débouchés solides."
    ),
    "No clear gain over your current rotation on these measures.": (
        "Aucun gain net par rapport à votre rotation actuelle sur ces mesures."
    ),
    "It adds less organic matter than your current rotation.": (
        "Elle ajoute moins de matière organique que votre rotation actuelle."
    ),
    "It grows less feed for livestock than your current rotation.": (
        "Elle produit moins d'aliments pour le bétail que votre rotation actuelle."
    ),
    "It breaks pest cycles less well than your current rotation.": (
        "Elle brise moins bien les cycles des ravageurs que votre rotation actuelle."
    ),
    "It may earn less, because more years are in crops with smaller markets.": (
        "Elle pourrait rapporter moins, car plus d'années sont en cultures aux débouchés "
        "plus restreints."
    ),
    # Checks for a crop or a cover crop
    "Alfalfa needs a hay buyer or your own livestock, and a few years to pay back its "
    "establishment.": (
        "La luzerne demande un acheteur de foin ou votre propre bétail, et quelques années "
        "pour rembourser son implantation."
    ),
    "Check local hay demand.": "Vérifiez la demande locale en foin.",
    "Canola needs a buyer within reach, and its disease risk (for example sclerotinia) "
    "depends on local conditions.": (
        "Le canola demande un acheteur à proximité, et son risque de maladie (par exemple "
        "la sclérotiniose) dépend des conditions locales."
    ),
    "Winter wheat must survive the winter.": "Le blé d'automne doit survivre à l'hiver.",
    "Check local winterkill risk and suitable varieties.": (
        "Vérifiez le risque local de destruction hivernale et les variétés adaptées."
    ),
    "Field pea loses yield in hot spells during flowering.": (
        "Le pois perd du rendement lors des vagues de chaleur pendant la floraison."
    ),
    "Check that a local buyer takes sorghum grain or forage.": (
        "Vérifiez qu'un acheteur local prend le grain ou le fourrage de sorgho."
    ),
    "A fallow year saves water but leaves soil bare.": (
        "Une année de jachère économise l'eau mais laisse le sol à nu."
    ),
    "Keep crop residue on the surface to limit erosion.": (
        "Laissez les résidus de culture en surface pour limiter l'érosion."
    ),
    "A cover crop needs seed, a planting window right after harvest, and a plan to end it "
    "in spring before planting.": (
        "Une culture de couverture demande de la semence, une fenêtre de semis juste après "
        "la récolte, et un plan pour la détruire au printemps avant le semis."
    ),
    "Check the timing with your equipment.": "Vérifiez le calendrier avec votre équipement.",
    "The nitrogen a legume leaves for the next crop depends on the stand and management.": (
        "L'azote qu'une légumineuse laisse à la culture suivante dépend du peuplement et de "
        "la régie."
    ),
    "Confirm with a soil test before cutting fertilizer.": (
        "Confirmez avec une analyse de sol avant de réduire l'engrais."
    ),
    "Dry years will cut yields.": "Les années sèches réduiront les rendements.",
    "Local pests and diseases decide how much a rotation helps.": (
        "Les ravageurs et maladies locaux déterminent l'effet réel d'une rotation."
    ),
    "Check with your local extension advisor.": "Vérifiez avec votre conseiller agricole local.",
    # Gaps
    "Bare-soil months come from typical crop calendars, not yet from satellite "
    "observations of this field.": (
        "Les mois de sol à nu viennent de calendriers de cultures typiques, pas encore "
        "d'observations satellitaires de ce champ."
    ),
    "Crop water use uses general crop coefficients (FAO-56).": (
        "Les besoins en eau des cultures reposent sur des coefficients généraux (FAO-56)."
    ),
    "Local varieties and planting dates change it.": (
        "Les variétés et les dates de semis locales les modifient."
    ),
    "Market suitability uses a general market class, not your local buyers.": (
        "L'évaluation des débouchés repose sur une catégorie de marché générale, pas sur vos "
        "acheteurs locaux."
    ),
    "Weather comes from a NASA POWER grid cell about 50 km across.": (
        "La météo vient d'une cellule NASA POWER d'environ 50 km de côté."
    ),
    "Your field's own microclimate can differ.": "Le microclimat de votre champ peut différer.",
    "No soil data here (we read soil maps for the U.S. and Canada only).": (
        "Aucune donnée de sol ici (nous lisons les cartes de sols des États-Unis et du "
        "Canada seulement)."
    ),
    "Soil water storage assumes a typical loam.": (
        "Le stockage d'eau du sol suppose un loam typique."
    ),
    "A soil test would replace this.": "Une analyse de sol remplacerait cette hypothèse.",
    "The soil data here has no slope, drainage or erodibility, so erosion risk from the "
    "field's own slope is unknown.": (
        "Les données de sol ici n'ont ni pente, ni drainage, ni érodibilité : le risque "
        "d'érosion lié à la pente du champ est inconnu."
    ),
    "A soil test would confirm them.": "Une analyse de sol les confirmerait.",
    # Conditions
    "Frost is rare here.": "Le gel est rare ici.",
    "No soil data for this point (we read soil maps for the U.S. and Canada).": (
        "Aucune donnée de sol pour ce point (nous lisons les cartes de sols des États-Unis "
        "et du Canada)."
    ),
    # Notes
    "This tool suggests options to explore.": "Cet outil propose des options à explorer.",
    "It does not decide for you: check any change with your local extension advisor or "
    "agronomist.": (
        "Il ne décide pas pour vous : validez tout changement avec votre conseiller agricole "
        "ou votre agronome."
    ),
    "Fewer than two alternatives passed the checks for this field (see the removed options "
    "and their reasons).": (
        "Moins de deux options ont passé les vérifications pour ce champ (voir les options "
        "écartées et leurs raisons)."
    ),
    "The soil survey service did not answer, so soil data is missing.": (
        "Le service des cartes de sols n'a pas répondu : les données de sol manquent."
    ),
    # Economics
    "Costs are the Iowa State budget's variable costs: seed, fertilizer, chemicals, crop "
    "insurance, fuel and repairs, drying and hauling, and interest.": (
        "Les coûts sont les coûts variables du budget d'Iowa State : semences, engrais, "
        "produits phytosanitaires, assurance récolte, carburant et réparations, séchage et "
        "transport, et intérêts."
    ),
    "Land, labour and machinery ownership are not included.": (
        "La terre, la main-d'œuvre et la propriété de la machinerie ne sont pas incluses."
    ),
    "Costs are the OMAFA budget's costs before land: seed, fertilizer, chemicals, "
    "machinery at custom rates, drying, insurance, interest and marketing.": (
        "Les coûts sont ceux du budget du MAAAO avant la terre : semences, engrais, produits "
        "phytosanitaires, machinerie à forfait, séchage, assurance, intérêts et mise en marché."
    ),
    "Land rent and farm overhead are not included.": (
        "Le loyer de la terre et les frais généraux de la ferme ne sont pas inclus."
    ),
    "There is no current published crop budget for this area.": (
        "Il n'existe pas de budget de cultures publié et à jour pour ce secteur."
    ),
    "Enter your own yields, prices and costs to compare rotations by margin.": (
        "Entrez vos propres rendements, prix et coûts pour comparer les rotations selon la marge."
    ),
    # Evidence labels and places
    "Frost-free season (median)": "Saison sans gel (médiane)",
    "Months with the most erosion-driving rain": "Mois aux pluies les plus érosives",
    "Crop water-use coefficients and root depths": (
        "Coefficients de besoins en eau et profondeurs racinaires"
    ),
    "general values for each crop": "valeurs générales pour chaque culture",
    "Months the field was seen bare": "Mois où le champ a été vu à nu",
    "Months less green than expected": "Mois moins verts que prévu",
    "NASA POWER grid cell (about 50 km) around the field": (
        "cellule NASA POWER (environ 50 km) autour du champ"
    ),
    "100 m modelled grid cell at the field point, topsoil 0–15 cm": (
        "cellule modélisée de 100 m au point du champ, sol de surface 0–15 cm"
    ),
    "soil map unit at the field point": "unité de carte de sols au point du champ",
    "the field point (30 m pixel)": "le point du champ (pixel de 30 m)",
    "250 m MODIS cell at the field": "cellule MODIS de 250 m au champ",
    "current model release": "version actuelle du modèle",
    "current survey": "levé actuel",
    "general": "général",
    # Satellite record (observed data files)
    "Nearest typical curve": "Courbe typique la plus proche",
    "Temporal CNN": "CNN temporel",
}

# Dataset names: translated where descriptive, otherwise left as their proper names.
DATASET_FR = {
    "NASA HLS 30 m greenness (Landsat + Sentinel-2, MODIS when cloudy)": (
        "Verdure NASA HLS 30 m (Landsat + Sentinel-2, MODIS par temps nuageux)"
    ),
    "MODIS greenness, unusual months by TimesFM 2.5 and the field average": (
        "Verdure MODIS, mois inhabituels selon TimesFM 2.5 et la moyenne du champ"
    ),
}

# English pattern → French, one sentence each; {x} matches any text, translated by _val.
PATTERNS = [
    # Conditions
    (
        "From {a} to {b}, this area got about {p} mm of rain a year.",
        "De {a} à {b}, ce secteur a reçu environ {p} mm de pluie par an.",
    ),
    (
        "The air could have taken up about {e} mm (reference evapotranspiration: the water a "
        "well-watered grass field would lose).",
        "L'air aurait pu en absorber environ {e} mm (évapotranspiration de référence : l'eau "
        "que perdrait une prairie bien arrosée).",
    ),
    (
        "In {m}, crops usually need more water than rain gives.",
        "En {m}, les cultures ont habituellement besoin de plus d'eau que n'en apporte la pluie.",
    ),
    (
        "The last spring frost is usually around {a} and the first fall frost around {b}: "
        "about {n} frost-free days.",
        "Le dernier gel du printemps survient d'habitude vers le {a} et le premier gel "
        "d'automne vers le {b} : environ {n} jours sans gel.",
    ),
    (
        "About {d} a year brings heavy rain (25 mm or more), most often in {m}.",
        "Environ {d} par an apporte de fortes pluies (25 mm ou plus), surtout en {m}.",
    ),
    (
        "About {d} a year bring heavy rain (25 mm or more), most often in {m}.",
        "Environ {d} par an apportent de fortes pluies (25 mm ou plus), surtout en {m}.",
    ),
    ("About {d} a year reaches 35 °C or more.", "Environ {d} par an atteint 35 °C ou plus."),
    ("About {d} a year reach 35 °C or more.", "Environ {d} par an atteignent 35 °C ou plus."),
    (
        "The last 10 years were {x}% {w}, with daily highs {t} °C {h}, than the 10 years before.",
        "Les 10 dernières années ont été plus {w} de {x} %, avec des maximums quotidiens plus "
        "{h} de {t} °C, que les 10 années précédentes.",
    ),
    (
        "Soil: {c} ({u}), about {o}% organic matter, slope about {s}%.",
        "Sol : {c} ({u}), environ {o} % de matière organique, pente d'environ {s} %.",
    ),
    (
        "Soil: {c} ({u}), about {o}% organic matter.",
        "Sol : {c} ({u}), environ {o} % de matière organique.",
    ),
    ("Soil: {c} ({u}), slope about {s}%.", "Sol : {c} ({u}), pente d'environ {s} %."),
    ("Soil: {c} ({u}).", "Sol : {c} ({u})."),
    # Why
    (
        "Suggested because you care about {g}, and it scores better there than your current "
        "rotation.",
        "Suggérée parce que vous tenez à {g}, et elle fait mieux que votre rotation actuelle "
        "sur ces points.",
    ),
    (
        "Replaces a repeated {a} year with {le_b} with winter rye cover.",
        "Remplace une année répétée de {a} par {le_b} avec un couvert de seigle d'automne.",
    ),
    ("Replaces a repeated {a} year with {le_b}.", "Remplace une année répétée de {a} par {le_b}."),
    (
        "Swaps {le_a} for {le_b} with winter rye cover.",
        "Remplace {le_a} par {le_b} avec un couvert de seigle d'automne.",
    ),
    ("Swaps {le_a} for {le_b}.", "Remplace {le_a} par {le_b}."),
    (
        "Keeps your current crops and adds a year of {a} with winter rye cover.",
        "Garde vos cultures actuelles et ajoute une année de {a} avec un couvert de seigle "
        "d'automne.",
    ),
    (
        "Keeps your current crops and adds a year of {a}.",
        "Garde vos cultures actuelles et ajoute une année de {a}.",
    ),
    # Benefits
    (
        "You already know how to grow it, and it gives about {m} months of living cover a year.",
        "Vous savez déjà la cultiver, et elle donne environ {m} mois de couvert vivant par an.",
    ),
    (
        "Uses less water: about {a} mm a year instead of {b} mm.",
        "Utilise moins d'eau : environ {a} mm par an au lieu de {b} mm.",
    ),
    (
        "Adds organic matter: about {a} months of living cover a year (now {b}), and more "
        "deep-rooted years.",
        "Ajoute de la matière organique : environ {a} mois de couvert vivant par an "
        "(actuellement {b}), et plus d'années à racines profondes.",
    ),
    (
        "Fixes more nitrogen: {a} of {b} years with a legume (now {c} of {d}).",
        "Fixe plus d'azote : {a} années sur {b} avec une légumineuse (actuellement {c} sur {d}).",
    ),
    (
        "Keeps the soil covered for about {a} months a year instead of {b}, including more of "
        "the heavy-rain months.",
        "Garde le sol couvert environ {a} mois par an au lieu de {b}, y compris pendant plus de "
        "mois de fortes pluies.",
    ),
    (
        "Breaks pest and disease cycles better: {a} crop families instead of {b}.",
        "Brise mieux les cycles des ravageurs et des maladies : {a} familles de cultures au "
        "lieu de {b}.",
    ),
    # Trade-offs
    (
        "It uses more water than your current rotation: about {a} mm a year instead of {b} mm.",
        "Elle utilise plus d'eau que votre rotation actuelle : environ {a} mm par an au lieu "
        "de {b} mm.",
    ),
    (
        "It has fewer legume years ({a} of {b}), so the next crops may need more nitrogen "
        "fertilizer.",
        "Elle compte moins d'années de légumineuses ({a} sur {b}), donc les cultures suivantes "
        "pourraient demander plus d'engrais azoté.",
    ),
    (
        "It leaves the soil bare for longer: about {a} bare months a year instead of {b}.",
        "Elle laisse le sol à nu plus longtemps : environ {a} mois à nu par an au lieu de {b}.",
    ),
    # Checks
    (
        "This area averages {d} a year at 35 °C or more, and {le_c} can lose yield in the heat.",
        "Ce secteur compte en moyenne {d} par an à 35 °C ou plus, et {le_c} peut perdre du "
        "rendement à la chaleur.",
    ),
    (
        "New crops ({c}) may need different equipment, seed or buyers.",
        "Les nouvelles cultures ({c}) peuvent demander un autre équipement, d'autres semences "
        "ou d'autres acheteurs.",
    ),
    (
        "In a typical year rain and stored soil water fall about {a} mm short of crop use.",
        "En année typique, la pluie et l'eau stockée dans le sol manquent d'environ {a} mm "
        "pour couvrir les besoins des cultures.",
    ),
    (
        "Soil texture and organic matter come from a modelled map ({d}).",
        "La texture et la matière organique du sol viennent d'une carte modélisée ({d}).",
    ),
    (
        "Satellites saw the field less green than expected in {m}: compare with what happened "
        "(late planting, drought, hail, pests, snow) before trusting the water scores.",
        "Les satellites ont vu le champ moins vert que prévu en {m} : comparez avec ce qui "
        "s'est passé (semis tardif, sécheresse, grêle, ravageurs, neige) avant de vous fier "
        "aux scores d'eau.",
    ),
    (
        "In {y} the crop map says {a}, but the field's greenness curve reads {b}: check your "
        "crop history for that year.",
        "En {y}, la carte des cultures indique {a}, mais la courbe de verdure du champ indique "
        "{b} : vérifiez votre historique de cultures pour cette année-là.",
    ),
    # Hard limits and removed options
    ("{c} needs about {n} frost-free days.", "{c} demande environ {n} jours sans gel."),
    ("This area has a median of {n}.", "Ce secteur en compte {n} en médiane."),
    (
        "Without irrigation, rain plus stored soil water covers only {p} of what {c} uses in a "
        "typical year.",
        "Sans irrigation, la pluie et l'eau stockée dans le sol ne couvrent que {p} de ce "
        "qu'utilise la culture ({c}) une année typique.",
    ),
    (
        "You said you can't grow or sell {c} here.",
        "Vous avez dit ne pas pouvoir cultiver ou vendre cette culture ici ({c}).",
    ),
    # Evidence labels and values
    ("{c}: rain vs crop water use, {m}", "{c} : pluie et besoins en eau, {m}"),
    ("{a} mm rain vs about {b} mm use", "{a} mm de pluie contre environ {b} mm utilisés"),
    ("Soil: {c}", "Sol : {c}"),
    (
        "{a} of {b} months seen bare, {c} of them in heavy-rain months",
        "{a} mois sur {b} vus à nu, dont {c} pendant des mois de fortes pluies",
    ),
    # Satellite record notes
    (
        "{n} held-out months, {p}, all demo fields",
        "{n} mois mis de côté, {p}, tous les champs d'exemple",
    ),
]


def _compile(en: str) -> re.Pattern[str]:
    out, pos = "", 0
    for m in re.finditer(r"\{(\w+)\}", en):
        # A value never crosses into the next sentence.
        out += re.escape(en[pos : m.start()]) + f"(?P<{m.group(1)}>(?:(?!\\. [A-Z]).)+?)"
        pos = m.end()
    return re.compile(out + re.escape(en[pos:]))


_RULES = [(_compile(en), fr_) for en, fr_ in PATTERNS]
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z\d])")


_FEMININE = {"luzerne", "jachère"}


def _with_article(crop: str) -> str:
    """ "blé de printemps" → "le blé de printemps", "avoine" → "l'avoine"."""
    first = crop.split()[0].lower()
    if first[0] in "aeiouyhéèêâîôû":
        return f"l'{crop}"
    return f"{'la' if first in _FEMININE else 'le'} {crop}"


def _value(name: str, text: str) -> str:
    """A placeholder's value in French. `le_*` placeholders are crop names that take an
    article; `g` is the list of goals after "tenez à", which repeats the "à"."""
    value = _val(text)
    if name.startswith("le_"):
        return _with_article(value)
    if name == "g":
        return re.sub(r"(, | et )", r"\1à ", value)
    return value


def _sentence(s: str) -> str | None:
    if s in EXACT:
        return EXACT[s]
    for rx, fr_ in _RULES:
        m = rx.fullmatch(s)
        if m:
            out = fr_.format(**{k: _value(k, v) for k, v in m.groupdict().items()})
            return re.sub(r"(?<=\.)\.$", "", out)  # "oct." ending a sentence: one period
    return None


def fr(text: str, loose: bool = False) -> tuple[str, bool]:
    """French for a text of one or more sentences, and whether every sentence was known.

    With `loose`, a short data value no rule knows (a month list, "176 days") gets its
    values translated and counts as known.
    """
    whole = _sentence(text)
    if whole is not None:
        return whole, True
    parts, ok = [], True
    for s in _SENTENCE_END.split(text):
        t = _sentence(s)
        if t is None:
            if loose:
                t = _val(s)
            else:
                ok = False
                t = s
        parts.append(t)
    return " ".join(parts), ok


def rotation_name_fr(name: str) -> str:
    """ "Alfalfa (3 yrs) – Corn + rye cover" → "Luzerne (3 ans) – Maïs + couvert de seigle"."""
    parts = []
    for part in name.split(" – "):
        m = re.fullmatch(r"(.*?)(?: \((\d+) yrs\))?( \+ rye cover)?", part)
        crop, years, cover = m.group(1), m.group(2), m.group(3)
        out = CROP_FR.get(crop, crop)
        if years:
            out += f" ({years} ans)"
        if cover:
            out += " + couvert de seigle"
        parts.append(out)
    return " – ".join(parts)


def crop_fr(name: str) -> str:
    return CROP_FR.get(name, name)


# ------------------------------------------------------------------------- responses


class _Misses(list[str]):
    def tr(self, text: str, loose: bool = False) -> str:
        out, ok = fr(text, loose)
        if not ok:
            self.append(text)
        return out

    def all(self, texts: list[str]) -> list[str]:
        return [self.tr(t) for t in texts]


def translate_response(r: AnalyzeResponse) -> list[str]:
    """Turn an English answer into French in place; return the English left untranslated."""
    miss = _Misses()
    r.conditions.summary = miss.all(r.conditions.summary)
    for s in r.strategies:
        s.name = rotation_name_fr(s.name)
        s.why = miss.all(s.why)
        s.benefits = miss.all(s.benefits)
        s.gaps = miss.all(s.gaps)
        s.local_review = miss.all(s.local_review)
        s.warnings = miss.all(s.warnings)
        for e in s.evidence:
            e.dataset = DATASET_FR.get(e.dataset, e.dataset)
            e.variable = miss.tr(e.variable)
            e.value = miss.tr(e.value, loose=True)
            e.place = miss.tr(e.place, loose=True)
            e.period = miss.tr(e.period, loose=True)
        if s.margin:
            s.margin.missing = [crop_fr(n) for n in s.margin.missing]
    for removed in r.removed:
        removed.name = rotation_name_fr(removed.name)
        removed.reason = miss.tr(removed.reason)
    r.notes = miss.all(r.notes)
    if r.economics:
        r.economics.basis = miss.tr(r.economics.basis)
        for line in r.economics.crops:
            line.name = crop_fr(line.name)
    return list(miss)


def translate_observed(field: ObservedField) -> list[str]:
    """Turn a prepared satellite record's labels into French in place; return misses."""
    miss = _Misses()
    for m in field.methods:
        m.name = _val(m.name)
        m.note = miss.tr(m.note)
    if field.crop_model:
        cm = field.crop_model
        cm.classes = [crop_fr(c) for c in cm.classes]
        for method in cm.methods:
            method.name = EXACT.get(method.name, method.name)
        cm.test_note = TEST_NOTE_FR.get(cm.test_note, cm.test_note)
        if cm.test_note not in TEST_NOTE_FR.values():
            miss.append(cm.test_note)
    for y in field.years:
        y.crop_label = y.crop_label and crop_fr(y.crop_label)
        y.model_crop_label = y.model_crop_label and crop_fr(y.model_crop_label)
        for month in y.months:
            for flag in month.flags:
                flag.methods = [_val(x) for x in flag.methods]
    return list(miss)


TEST_NOTE_FR = {
    "Chosen by leave-one-season-out cross-validation on 2019–2022, then tested once on "
    "2023–2024 in 3 km blocks never used for training, eastern Ontario (HLS tile T18TVR). "
    "Labels are AAFC's crop map, itself a model's output.": (
        "Choisi par validation croisée (une saison laissée de côté à la fois) sur 2019–2022, "
        "puis testé une seule fois sur 2023–2024 dans des blocs de 3 km jamais utilisés pour "
        "l'entraînement, dans l'Est de l'Ontario (tuile HLS T18TVR). Les étiquettes viennent de la "
        "carte des cultures d'AAC, elle-même produite par un modèle."
    ),
}

CROP_HISTORY_SOURCE_FR = {
    "AAFC Annual Crop Inventory (Agriculture and Agri-Food Canada)": (
        "Inventaire annuel des cultures d'AAC (Agriculture et Agroalimentaire Canada)"
    ),
    "USDA NASS Cropland Data Layer (CropScape)": (
        "USDA NASS Cropland Data Layer (CropScape, États-Unis)"
    ),
}
