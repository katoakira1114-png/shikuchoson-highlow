// 開発用のダミーデータを作る（本物の統計ではありません）。
// 都道府県名は本物、自治体名と数値は架空です。
import { writeFileSync } from 'node:fs';

const PREFS = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];
const IND = [
  ['population','総人口','人','人口'], ['households','世帯数','世帯','人口'], ['elderly_ratio','65歳以上の割合','%','人口'],
  ['area','面積','km²','土地'], ['forest_ratio','森林の割合','%','土地'], ['tax','地方税の収入','百万円','財政'],
  ['fiscal_index','財政力指数','','財政'], ['agri_output','農業産出額','千万円','産業'], ['factories','製造品出荷額','百万円','産業'],
  ['rice','米の産出額','千万円','農産物'], ['fish_entities','漁業経営体の数','経営体','水産物'], ['schools','小学校の数','校','生活'],
  ['hospitals','病院の数','施設','生活'], ['furusato','ふるさと納税の受入額','百万円','経済'],
];
let s = 12345;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const munis = [];
PREFS.forEach((p, pi) => {
  const n = 5 + Math.floor(rnd() * 15);
  for (let j = 0; j < n; j++) {
    const k = j === 0 ? '市' : ['市', '町', '町', '村'][Math.floor(rnd() * 4)];
    const pop = Math.round(Math.exp(7 + rnd() * 7));
    const v = [
      pop, Math.round(pop / (2 + rnd())), +(20 + rnd() * 25).toFixed(1),
      +(20 + rnd() * 800).toFixed(2), +(rnd() * 95).toFixed(1), Math.round(pop * (0.1 + rnd() * 0.2) / 1000),
      +(0.1 + rnd() * 1.1).toFixed(2), Math.round(rnd() < 0.15 ? 0 : rnd() * 3000), Math.round(rnd() * pop * 3),
      Math.round(rnd() < 0.2 ? 0 : rnd() * 800), rnd() < 0.5 ? 0 : Math.round(rnd() * 400), Math.max(1, Math.round(pop / 6000)),
      Math.round(pop / 25000), rnd() < 0.1 ? null : Math.round(rnd() * 5000),
    ];
    munis.push({ c: String((pi + 1) * 1000 + j + 1).padStart(5, '0') + '0', n: `ダミー${k}${pi + 1}-${j + 1}`, p, k, v });
  }
});
const ds = {
  version: 'dummy-1', dummy: true,
  indicators: IND.map(([id, name, unit, category]) => ({ id, name, unit, year: 'ダミー', category, source: '開発用ダミーデータ' })),
  munis,
};
writeFileSync(new URL('../data/dataset.json', import.meta.url), JSON.stringify(ds));
console.log(`dummy dataset: ${munis.length} munis, ${IND.length} indicators`);
