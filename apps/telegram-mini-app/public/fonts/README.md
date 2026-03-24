# TON Brand Fonts

Place the following `.woff2` files in this directory:

## ABC Diatype (headings, buttons, UI text)
- `ABCDiatype-Regular.woff2`
- `ABCDiatype-Medium.woff2`
- `ABCDiatype-Bold.woff2`

Source: Licensed from Dinamo Typefaces — https://abcdinamo.com/typefaces/diatype

## Suisse Int'l Mono (financial data, addresses, APY)
- `SuisseIntlMono-Regular.woff2`
- `SuisseIntlMono-Medium.woff2`

Source: Licensed from Swiss Typefaces — https://www.swisstypefaces.com/fonts/suisse/

## Fallback behavior

If font files are missing, the app gracefully falls back to:
- ABC Diatype → SF Pro Display → system sans-serif
- Suisse Int'l Mono → SF Mono → Menlo → system monospace

The UI remains fully functional without the commercial fonts.
