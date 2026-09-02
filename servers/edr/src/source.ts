/**
 * Where the dump comes from.
 *
 * These lived only in README.md, which meant nothing could check them: if the
 * Ministry moved a file or renamed a field, the first sign would be an import
 * that silently produced zero companies. Here they are values the contract test
 * can actually probe.
 *
 * Verified 27.08.2026 against data.gov.ua.
 */

const DATASET = "https://data.gov.ua/dataset/03cc1239-3988-4451-aa0d-aadb77448714";

/** Full register of legal entities, ~327 MB zipped, ~3.2 GB of windows-1251 XML. */
export const UO_DUMP_URL = `${DATASET}/resource/d40cc921-39bb-44fd-be06-dc02589f45c6/download/uo.zip`;

/** The XSD for the above, a few kilobytes — cheap enough to check on every run. */
export const UO_SCHEMA_URL = `${DATASET}/resource/131e73ef-eeff-4374-aa23-0c7e10d6509c/download/uo_schema.zip`;

/** Human-facing page, for when a link above stops resolving. */
export const DATASET_PAGE = DATASET;

/**
 * The element and field names `parse.ts` depends on. If the register drops or
 * renames any of these, the parser keeps running and quietly returns less —
 * which is exactly the failure that is invisible without a test.
 */
export const REQUIRED_SCHEMA_FIELDS = [
  "SUBJECT",
  "EDRPOU",
  "NAME",
  "SHORT_NAME",
  "STAN",
  "FOUNDERS",
  "FOUNDER",
  "SIGNERS",
  "SIGNER",
  "BENEFICIARIES",
  "BENEFICIARY",
  "MEMBERS",
  "MEMBER",
] as const;
