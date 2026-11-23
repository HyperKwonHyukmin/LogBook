/** 69 — 업무별 모음(대상 화면) 주소. '기타'는 화면이 없어 검색(대상 = 기타)으로 보낸다. */
import { filterHref } from './search.js';

export const OTHER_TARGET = '기타';
export const targetHref = (value) => (value === OTHER_TARGET ? filterHref('target', value) : `/t/${encodeURIComponent(value)}`);
