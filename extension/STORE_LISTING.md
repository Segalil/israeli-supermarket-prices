# Chrome Web Store — חומרי הגשה מוכנים להדבקה

## פרטי חשבון (פעם אחת)
1. https://chrome.google.com/webstore/devconsole → התחברות עם חשבון Google
2. תשלום חד־פעמי של $5 (דמי רישום מפתח)

## העלאה
Developer Dashboard → **New item** → העלאת `extension.zip` (נבנה בתיקייה זו).

## Store listing (להדבקה)

**שם:**
ליםSlim — העברת סל לרשתות

**תיאור קצר (עד 132 תווים):**
מעביר את רשימת הקניות מ־ליםSlim אל עגלת הקנייה באתר הרשת — בתוך החשבון שלכם ובשליטתכם המלאה.

**תיאור מלא:**
ליםSlim משווה את סל הקניות שלכם בין חנויות האונליין של רשתות המזון המובילות
בישראל, על בסיס נתוני שקיפות המחירים הרשמיים — כולל מבצעים.

התוסף סוגר את המעגל: אחרי שבחרתם באתר את הרשת הזולה, הוא מלווה אתכם באתר
הרשת ומעביר את הרשימה לעגלה — פריט אחרי פריט:

• חיפוש כל מוצר לפי ברקוד באתר הרשת
• הוספה אוטומטית לעגלה בכמות הנכונה, כשמבנה הדף מזוהה
• מצב מלווה כשלא — קישור חיפוש ולחיצת "הוספתי"
• מעקב התקדמות שנשמר בין דפים
• הכול בתוך החשבון שלכם: התוסף לא מבקש סיסמאות, לא מתחבר בשמכם
  ולא שולח מידע לשום שרת

רשתות נתמכות: שופרסל, רמי לוי, ויקטורי, יינות ביתן / קרפור, יוחננוף.

האתר: https://segalil.github.io/israeli-supermarket-prices/

**קטגוריה:** Shopping
**שפה:** עברית

## Privacy (טופס ה־Privacy practices — חובה)

**Single purpose description:**
Transfers the user's shopping list from the ליםSlim price-comparison site into
the shopping cart on the selected supermarket's website, inside the user's own
session and under their control.

**Permission justifications:**
- `storage` — holds the user's transfer list (items + chosen chain) locally so
  it survives page navigations on the supermarket site. Nothing is transmitted.
- Host access `segalil.github.io` — reads the transfer list the user created on
  the ליםSlim site.
- Host access `shufersal.co.il`, `rami-levy.co.il`, `yochananof.co.il`,
  `victoryonline.co.il`, `carrefour.co.il` — shows the transfer panel and
  performs the add-to-cart clicks the user requested on these supermarkets.

**Data usage:** The extension does not collect, transmit, sell, or share any
user data. The shopping list is stored locally (chrome.storage.local) only.

**Privacy policy URL:**
https://segalil.github.io/israeli-supermarket-prices/#/terms

## נכסים גרפיים
- אייקון 128px: `icons/icon128.png` (כבר בתוך ה־zip)
- **צילום מסך (חובה, לפחות אחד, ‎1280×800):** התקינו את התוסף (Load unpacked),
  הכינו הזמנה באתר, פתחו את אתר שופרסל עם הפאנל הפעיל וצלמו מסך.
- Small promo tile ‎440×280 (רשות): אפשר לחתוך מהאייקון על רקע ‎#f7f4f1.

## הערות לביקורת (Review notes — שדה אופציונלי, מומלץ)
The extension automates only explicit user actions (adding the user's own
grocery list to their own cart) on the supported supermarket sites, similar to
the user clicking manually. No credentials are handled; no data leaves the
browser.
