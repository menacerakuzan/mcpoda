/**
 * A light Ukrainian stemmer for search, not for linguistics.
 *
 * The problem it solves is concrete: FTS5 matches tokens literally, so a person
 * asking about «дорога» finds nothing in a corpus that says «дороги» and
 * «доріг». Prefix search does not save us either, because Ukrainian alternates
 * vowels inside the stem: дорога → доріг, ремонт → ремонті, ніч → ночі.
 *
 * The rule is consistency, not correctness: the same function runs over the
 * indexed text and over the query, so as long as both forms collapse to the same
 * string, the search finds them. Some unrelated words will collide (сіль and
 * соль fold together). That costs a little precision and buys a lot of recall,
 * which is the right trade for a corpus where a missed procurement is worse than
 * an extra one. The original title stays indexed separately, so exact phrases
 * still work.
 */

/** Longest first: «ами» must be stripped before «а». */
const ENDINGS = [
  "ості",
  "ьом",
  "ями",
  "ами",
  "ові",
  "єві",
  "ієї",
  "ього",
  "ому",
  "ему",
  "ими",
  "іми",
  "их",
  "ій",
  "ої",
  "ою",
  "ею",
  "ів",
  "їв",
  "ям",
  "ам",
  "ом",
  "ем",
  "ях",
  "ах",
  "ей",
  "ий",
  "ой",
  "ії",
  "ія",
  "ю",
  "я",
  "і",
  "и",
  "у",
  "о",
  "е",
  "є",
  "ї",
  "а",
];

/** The stem must survive: stripping «ремонт» down to «рем» would be worse. */
const MIN_STEM = 4;

/**
 * Two alternations split one word into several tokens, and both have to be
 * folded for the forms to meet:
 *
 * vowels — о and е rise to і in closed syllables (дорога → доріг);
 * consonants — г, к, х soften to з, ц, с before і (дорога → дорозі).
 *
 * Folding runs in one direction only, so every form lands on the same string.
 */
function foldAlternations(stem: string) {
  const folded = stem.replace(/і/g, "о");
  return folded.replace(/[зцс]$/, (last) =>
    last === "з" ? "г" : last === "ц" ? "к" : "х",
  );
}

export function normalizeWord(word: string): string {
  let stem = word
    .toLowerCase()
    .replace(/['’ʼ`]/g, "")
    .replace(/ґ/g, "г")
    // a soft sign is never part of the stem for our purposes and only splits
    // автомобіль from автомобілі
    .replace(/ь/g, "");

  if (stem.length <= MIN_STEM) return foldAlternations(stem);

  for (const ending of ENDINGS) {
    if (stem.length - ending.length >= MIN_STEM && stem.endsWith(ending)) {
      stem = stem.slice(0, -ending.length);
      break;
    }
  }

  return foldAlternations(stem);
}

/** Words shorter than this carry no search value and only bloat the index. */
const MIN_TOKEN = 2;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}'’ʼ]+/u)
    .filter((token) => token.length >= MIN_TOKEN);
}

/** The searchable form of a title or item description. */
export function normalizeText(text: string): string {
  return tokenize(text).map(normalizeWord).join(" ");
}

/**
 * Digits and codes must survive untouched: CPV «45233142-6» and a procedure
 * number are looked up literally, and stemming them would destroy the match.
 */
export function normalizeQuery(query: string): string {
  return tokenize(query)
    .map((token) => (/\d/.test(token) ? token : normalizeWord(token)))
    .join(" ");
}
