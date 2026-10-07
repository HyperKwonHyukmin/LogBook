import { isListed, matchTerms, resolveTerm, vocabKey } from './vocab.js';

const TERMS = [
  { id: 1, value: '강도 평가', active: true, synonyms: [] },
  { id: 2, value: 'FE 해석', active: true, synonyms: [{ id: 10, value: 'FEM 해석' }, { id: 11, value: 'FEA' }] },
  { id: 3, value: '옛 해석', active: false, synonyms: [] },
  { id: 4, value: '기타', active: true, synonyms: [] },
];

test('표기 열쇠는 공백·대소문자를 무시한다', () => {
  expect(vocabKey(' 강도  평가 ')).toBe(vocabKey('강도평가'));
  expect(vocabKey('FE 해석')).toBe(vocabKey('fe해석'));
});

test('동의어·표기 변형을 용어로 맞춘다', () => {
  expect(resolveTerm(TERMS, 'fem 해석').value).toBe('FE 해석');
  expect(resolveTerm(TERMS, '강도평가').value).toBe('강도 평가');
  expect(resolveTerm(TERMS, '없는 값')).toBeNull();
});

test('후보는 사용 중인 용어만, 동의어로 맞으면 via 를 단다', () => {
  expect(matchTerms(TERMS, '').map((m) => m.term.value)).toEqual(['강도 평가', 'FE 해석', '기타']);
  expect(matchTerms(TERMS, 'FEM')).toEqual([{ term: TERMS[1], via: 'FEM 해석' }]);
  expect(matchTerms(TERMS, '', ['기타']).map((m) => m.term.value)).toEqual(['강도 평가', 'FE 해석']);
  expect(isListed(TERMS, 'fe 해석')).toBe(true);
  expect(isListed(TERMS, '구조 강도')).toBe(false);
});
