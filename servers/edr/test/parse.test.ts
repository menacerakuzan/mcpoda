import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SubjectStream,
  normalizeName,
  parsePersonField,
  parseSubjectBlock,
} from "../dist/parse.js";

const subject = (inner: string) => `<SUBJECT>${inner}</SUBJECT>\n`;

const minimal = subject(
  "<RECORD>1</RECORD><NAME>ТОВ &quot;РОМАШКА&quot;</NAME><SHORT_NAME/><EDRPOU>12345678</EDRPOU>" +
    "<STAN>зареєстровано</STAN><FOUNDERS><FOUNDER>ІВАНЕНКО ІВАН ІВАНОВИЧ; розмір внеску - 1000,00 грн.</FOUNDER></FOUNDERS>" +
    "<SIGNERS><SIGNER>ІВАНЕНКО ІВАН ІВАНОВИЧ - директор</SIGNER></SIGNERS><BENEFICIARIES/><MEMBERS/>",
);

describe("parseSubjectBlock", () => {
  it("витягує ЄДРПОУ, назву і людей з ролями", () => {
    const company = parseSubjectBlock(minimal);
    assert.ok(company);
    assert.equal(company!.edrpou, "12345678");
    assert.equal(company!.name, `ТОВ "РОМАШКА"`, "не розкодував &quot;");
    assert.equal(company!.people.length, 2);
    assert.equal(company!.people[0].role, "founder");
    assert.equal(company!.people[1].role, "signer");
  });

  it("повертає null без ЄДРПОУ чи назви", () => {
    const broken = subject("<RECORD>1</RECORD><EDRPOU>12345678</EDRPOU>");
    assert.equal(parseSubjectBlock(broken), null);
  });
});

describe("parsePersonField", () => {
  it("розбирає засновника-фізособу з часткою", () => {
    const p = parsePersonField("ІВАНЕНКО ІВАН ІВАНОВИЧ; розмір внеску - 1000,00 грн.", "founder");
    assert.equal(p.name, "ІВАНЕНКО ІВАН ІВАНОВИЧ");
    assert.equal(p.relatedEdrpou, null);
  });

  it("витягує ЄДРПОУ засновника-юрособи", () => {
    const p = parsePersonField("ПРАТ РОМАШКА; 22824090; розмір внеску - 0,00 грн.", "founder");
    assert.equal(p.relatedEdrpou, "22824090");
  });

  it("витягує ім'я підписанта до тире-ролі", () => {
    const p = parsePersonField("ПЕТРЕНКО ПЕТРО ПЕТРОВИЧ - директор", "signer");
    assert.equal(p.name, "ПЕТРЕНКО ПЕТРО ПЕТРОВИЧ");
  });

  it("не ламається на вбудованому тексті довіреності в дужках", () => {
    const raw =
      "ПРОЦИК ІРИНА ІВАНІВНА; (Повноваження: чинити дії від імені юридичної особи " +
      "(складна структура з (вкладеними) дужками)) - представник";
    const p = parsePersonField(raw, "signer");
    assert.equal(p.name, "ПРОЦИК ІРИНА ІВАНІВНА");
    assert.equal(p.raw, raw);
  });

  it("не сприймає пояснення відсутності бенефіціара за ім'я людини", () => {
    // Found by importing a real 300 MB slice of UO.xml: this boilerplate is
    // recited by hundreds of unrelated companies whenever BENEFICIARY has no
    // actual beneficiary, and without this guard every pair of them would
    // show up as a "shared person" in proyav_edr_shared_people.
    const raw =
      "причина відсутності: Відсутні фізичні особи, які відповідають статусу кінцевого бенефіціарного власника юридичної особи";
    assert.equal(parsePersonField(raw, "beneficiary"), null);
  });

  it("не сприймає узагальнені позначення групи людей за ім'я", () => {
    // Same real-import finding as the absence-reason case: these recur across
    // hundreds of unrelated companies (co-op founders, union members) and are
    // never one identifiable person.
    for (const raw of [
      "ФІЗИЧНІ ОСОБИ; розмір частки - 0,00 грн.",
      "НЕВИЗНАЧЕНА ФІЗИЧНА ОСОБА - керівник",
      "ЧЛЕНИ ПРОФСПІЛКИ; розмір частки - 0,00 грн.",
      "[ЗАСНОВНИК]",
      "0 0; розмір частки - 0,00 грн.",
    ]) {
      assert.equal(parsePersonField(raw, "founder"), null, raw);
    }
  });

  it("не фільтрує реальні організації-засновники, як-от міністерства", () => {
    const p = parsePersonField("МІНІСТЕРСТВО ЮСТИЦІЇ УКРАЇНИ; розмір частки - 100,00 грн.", "founder");
    assert.ok(p);
    assert.equal(p!.name, "МІНІСТЕРСТВО ЮСТИЦІЇ УКРАЇНИ");
  });

  it("відділяє ім'я від дужок навіть без крапки з комою перед ними", () => {
    // Unlike the case above, nothing separates the name from the parenthetical
    // here — this is what actually exercises the paren-stripping step, since
    // splitting on ";" alone would already isolate the name when one is present.
    const raw = "ГРИЦЕНКО ОЛЕНА ВІКТОРІВНА (Повноваження: підписувати договори) - представник";
    const p = parsePersonField(raw, "signer");
    assert.equal(p.name, "ГРИЦЕНКО ОЛЕНА ВІКТОРІВНА");
  });
});

describe("normalizeName", () => {
  it("зводить регістр, лапки й пробіли до одного вигляду", () => {
    assert.equal(
      normalizeName(`Іваненко  Іван,  Іванович`),
      normalizeName(`ІВАНЕНКО ІВАН ІВАНОВИЧ`),
    );
  });
});

describe("SubjectStream", () => {
  it("парсить кілька записів, надісланих одним шматком", () => {
    const stream = new SubjectStream();
    const out = stream.push(minimal + minimal);
    assert.equal(out.length, 2);
  });

  it("складає запис, розірваний на довільній межі шматка", () => {
    const stream = new SubjectStream();
    const whole = minimal;
    const cut = 47; // falls inside a tag, not on a boundary
    const first = stream.push(whole.slice(0, cut));
    assert.equal(first.length, 0, "видав неповний запис");
    const second = stream.push(whole.slice(cut));
    assert.equal(second.length, 1);
    assert.equal(second[0].edrpou, "12345678");
  });

  it("не втрачає запис, чиє текстове поле містить символ переносу рядка", () => {
    const withNewline = subject(
      "<RECORD>2</RECORD><NAME>ТОВ ЛІЛІЯ</NAME><EDRPOU>87654321</EDRPOU><STAN>зареєстровано</STAN>" +
        "<SIGNERS><SIGNER>ПЕТРЕНКО ПЕТРО;\n(текст довіреності на кілька рядків\nз реальним переносом)) - представник</SIGNER></SIGNERS>",
    );
    const stream = new SubjectStream();
    // Simulate the newline landing at a chunk boundary, as it does in the real file.
    const idx = withNewline.indexOf("\n(текст");
    const out = [...stream.push(withNewline.slice(0, idx + 1)), ...stream.push(withNewline.slice(idx + 1))];
    assert.equal(out.length, 1);
    assert.equal(out[0].edrpou, "87654321");
    assert.equal(out[0].people[0].name, "ПЕТРЕНКО ПЕТРО");
  });
});
