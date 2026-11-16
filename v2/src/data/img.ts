// 作品画像の置き場所と大きさ。
// 画像は public/img/wall/NNN.webp(大・長辺1500px)と NNN-s.webp(小・長辺560px)。
import sizes from './wall-size.json';

const base = import.meta.env.BASE_URL.replace(/\/$/, '');
const pad = (n: number) => String(n).padStart(3, '0');

export const imgLarge = (n: number) => `${base}/img/wall/${pad(n)}.webp`;
export const imgSmall = (n: number) => `${base}/img/wall/${pad(n)}-s.webp`;

/** 大きい方の画像の [幅, 高さ]。 */
export function imgSize(n: number): [number, number] {
  return ((sizes as Record<string, number[]>)[String(n)] as [number, number]) ?? [1500, 1000];
}
export const imgRatio = (n: number) => {
  const [w, h] = imgSize(n);
  return w / h;
};
