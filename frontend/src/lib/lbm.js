/** model.lbm 읽기(04a Task 3 형식). 블록은 버퍼를 복사하지 않는 TypedArray 보기로 준다(4바이트 정렬). */
const TYPES = { '<i4': Int32Array, '<f4': Float32Array, '|u1': Uint8Array };

export function parseLbm(buffer) {
  const bytes = new Uint8Array(buffer);
  const magic = new TextDecoder().decode(bytes.subarray(0, 4));
  if (magic !== 'LBM1') throw new Error('LBM 형식이 아닙니다');
  const hlen = new DataView(buffer).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hlen)));
  const base = 8 + hlen;
  const blocks = {};
  const width = {};
  for (const [name, meta] of Object.entries(header.blocks || {})) {
    const T = TYPES[meta.dtype];
    if (!T) throw new Error(`LBM 블록 형식 미지원: ${meta.dtype}`);
    const n = meta.count * meta.width;
    const start = base + meta.offset;
    // 정렬이 맞으면 보기로, 아니면(이론상 없음) 복사
    blocks[name] = start % T.BYTES_PER_ELEMENT === 0
      ? new T(buffer, start, n)
      : new T(buffer.slice(start, start + n * T.BYTES_PER_ELEMENT));
    width[name] = meta.width;
  }
  return { header, blocks, width };
}
