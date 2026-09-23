import {createRequire} from 'node:module';
import {uncompressedWoff} from './pdf-font.mjs';
const require=createRequire(import.meta.url);
export const pdfFonts={regular:require.resolve('@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff'),bold:require.resolve('@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-700-normal.woff')};
const data={regular:uncompressedWoff(pdfFonts.regular),bold:uncompressedWoff(pdfFonts.bold)};
export const getFontData=()=>data;
