// Rule-based masking for AI input and minutes evidence. Names without a label or honorific
// cannot reliably be distinguished from ordinary words by these rules.
const PERSON_NAME = String.raw`(?:[一-龯々]{1,8}(?:(?!です|と申します|といいます|さん|さま)[ぁ-ん]){1,6}?|[一-龯々]{1,8}(?:[ \u3000]+[一-龯々]{1,8})?|[ァ-ヶー]{2,20}(?:[ \u3000・]+[ァ-ヶー]{2,20})*|[A-Za-z]{2,30}(?:[ \u3000]+[A-Za-z]{2,30})*)`;
const NON_NAME_TITLES = new Set([
  "医者", "医師", "看護師", "看護婦", "介護士", "介護者", "患者",
  "家族", "皆", "皆様", "利用者", "職員", "先生", "父", "母", "兄", "姉",
  "弟", "妹", "子供", "子ども", "息子", "娘", "孫", "隣", "近所", "客",
]);
const ADDRESS_CHARS = String.raw`[一-龯々ァ-ヶーA-Za-z0-9０-９・\u3000－−‐–―\-]`;
const PREFECTURE = String.raw`(?:北海道|東京都|(?:京都|大阪)府|[一-龯]{2,3}県)`;

export function anonymizeACPText(
  value: string,
  options: { maskOpaqueIdentifiers?: boolean } = {},
) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[メール]")
    .replace(/(?<![0-9０-９-－])(?:〒\s*)?[0-9０-９]{3}[-－]\s*[0-9０-９]{4}(?![0-9０-９]|[-－][0-9０-９])/g, "[郵便番号]")
    // Explicit address labels also cover addresses written without a prefecture.
    .replace(
      /((?:住所|所在地|居住地)\s*(?:は|が|[:：])\s*)[「『]?([^。！？!?\n「」『』]+)[」』]?/g,
      (_match, label: string, address: string) => {
        const ending = address.match(/(?:に住んで.*|で暮らして.*|です.*|になります.*)$/)?.[0] ?? "";
        return `${label}[住所]${ending}`;
      },
    )
    .replace(
      new RegExp(`${PREFECTURE}[一-龯々ヶケ]{1,12}(?:市|区|郡|町|村)${ADDRESS_CHARS}*`, "g"),
      "[住所]",
    )
    // Street addresses without a prefecture, including hyphenated house numbers.
    .replace(
      /[一-龯々ヶケ]{1,12}(?:市|区|町|村)[一-龯々ヶケ]{0,12}[0-9０-９一二三四五六七八九十]+(?:丁目|番地|番|[-－−])[0-9０-９一二三四五六七八九十－−-]*(?:番地|番|号)?/g,
      "[住所]",
    )
    .replace(/\b\d{2,4}[-\s]?\d{2,4}[-\s]?\d{3,4}\b/g, "[電話番号]")
    .replace(
      /((?:氏名|姓名|名前)\s*(?:は|が|[:：])\s*)[「『]?([ぁ-んー]{2,30}?)(?=[」』]|です|と申します|といいます|[、。\n]|$)[」』]?/g,
      "$1[氏名]",
    )
    .replace(
      new RegExp(String.raw`((?:氏名|姓名|名前|姓|名)\s*(?:は|が|[:：])\s*)[「『]?(${PERSON_NAME})(?=[」』]|です|と申します|といいます|さん|さま|様|[、。\n]|$)[」』]?`, "g"),
      "$1[氏名]",
    )
    .replace(
      new RegExp(String.raw`(${PERSON_NAME})(と申します|といいます|という名前)`, "g"),
      "[氏名]$2",
    )
    .replace(
      new RegExp(String.raw`(${PERSON_NAME})(さん|さま|様|氏|先生)(?=$|[はがをにとのもへ、。！？!?\s「」『』])`, "g"),
      (match, name: string, honorific: string) =>
        NON_NAME_TITLES.has(name.trim()) ? match : `[氏名]${honorific}`,
    )
    .replace(/\b(?:patient|participant|研究参加者|患者)[-_ ]?[A-Za-z0-9]{3,}\b/gi, "[ID]")
    .replace(/[A-Za-z0-9_-]{8,}/g,
      (match) => options.maskOpaqueIdentifiers === false ? match : "[ID]")
    .replace(/([一-龯]{2,4})(病院|クリニック|医院|医療センター)/g, "[医療機関]")
    .trim();
}
