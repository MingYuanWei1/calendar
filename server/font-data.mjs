import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {uncompressedWoff} from './pdf-font.mjs';
const require=createRequire(import.meta.url);
// brand (Manrope) and script (Caveat) set the "Keydion Calendar" wordmark; logo is the K tile drawn beside it.
export const pdfFonts={regular:require.resolve('@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff'),bold:require.resolve('@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-700-normal.woff'),brand:require.resolve('@fontsource/manrope/files/manrope-latin-400-normal.woff'),script:require.resolve('@fontsource/caveat/files/caveat-latin-400-normal.woff')};
const data={regular:uncompressedWoff(pdfFonts.regular),bold:uncompressedWoff(pdfFonts.bold),brand:uncompressedWoff(pdfFonts.brand),script:uncompressedWoff(pdfFonts.script),logo:readFileSync(new URL('../public/logo.png',import.meta.url))};
export const getFontData=()=>data;
