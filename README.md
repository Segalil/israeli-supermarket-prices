# israeli-supermarket-prices

בניית דאטהבייס (Excel + CSV) של מחירי מוצרים מחנויות ה**אונליין** של רשתות המזון
המובילות בישראל, מתוך קבצי **שקיפות המחירים** הרשמיים (חוק המזון). הנתונים חוקיים
ופומביים — כל רשת קמעונאית גדולה מחויבת לפרסם אותם.

> Build an Excel/CSV price database from Israel's official supermarket
> price-transparency files, for the online stores of the leading chains.

## Features
- מוריד את קבצי `PriceFull` הרשמיים דרך [`il-supermarket-scraper`](https://pypi.org/project/il-supermarket-scraper/).
- מזהה אוטומטית את חנות האונליין של כל רשת (לפי קובץ הסניפים); אם אין — נלקח סניף מייצג.
- מפענח את שתי וריאציות סכימת ה‑XML (`<Item>` / `<Product>`), כולל `gzip` וקידוד `windows-1255`.
- מייצא ל‑CSV (UTF‑8 BOM, נפתח נכון באקסל) ול‑XLSX עם גיליון נתונים + גיליון סיכום.

## Install
```bash
pip install -r requirements.txt
```
Requires Python 3.9+.

## Usage
```bash
python build_price_db.py                         # 8 leading chains, online store
python build_price_db.py --chains SHUFERSAL RAMI_LEVY
python build_price_db.py --all-stores            # every branch (very large!)
```
פלט נכתב לתיקיית `out/`:
- `israeli_prices_YYYYMMDD.csv`
- `israeli_prices_YYYYMMDD.xlsx` (גיליונות `מחירים` + `סיכום`)

## Chains included by default
שופרסל · רמי לוי · ויקטורי · יינות ביתן/קרפור · יוחננוף · טיב טעם · אושר עד · חצי חינם

מפתחות הרשתות מוגדרים במילון `LEADING_CHAINS` שבתוך `build_price_db.py` וניתן להרחיב
אותם לכל רשת שהספרייה תומכת בה.

## Columns
`רשת · מזהה רשת · מזהה חנות · ברקוד · שם מוצר · יצרן · ארץ ייצור · כמות · יחידת מידה ·
מחיר (₪) · מחיר ליחידה (₪) · שקיל · כמות באריזה · מותר הנחה · סטטוס · עודכן`

## Tests
```bash
python -m pytest -q          # or: python tests/test_parser.py
```
הבדיקות רצות על קבצי הדוגמה שב‑`samples/` ואינן דורשות רשת.

## Notes
- הרשתות מעדכנות את הקבצים אחת ליום בערך — זו תמונת מצב חד‑פעמית; הרץ שוב לנתונים טריים.
- מומלץ להריץ ממחשב עם גישה חופשית לאינטרנט הישראלי (אתרי הרשתות עשויים להיחסם מ‑egress מוגבל/ענני).
- מקור הנתונים: פרויקט שקיפות המחירים של משרד הכלכלה — [gov.il](https://www.gov.il/he/pages/cpfta_prices_regulations).

## License
MIT — see [LICENSE](LICENSE).
