// 45 — 시리즈 호선. 같은 설계로 지은 호선(PLM 선행호선이 같은 배)은 '호선' 기준에서 한 묶음으로 본다.
// 서버 응답(관계 지도 · 갖춤 현황): hull_series = {호선: 묶음 키(대표 호선)} — 자기 번호와 다른 것만,
// series_members = {묶음 키: 이 응답에 나온 호선들} — 둘 이상인 것만.

/** 호선 → 묶음 키(시리즈가 아니면 자기 번호). */
export const seriesKeyOf = (data) => {
  const map = data?.hull_series || {};
  return (hull) => map[hull] || hull;
};

/** 묶음 키의 호선들(이 응답 안). 시리즈가 아니면 [키]. */
export const seriesMembers = (data, key) => data?.series_members?.[key] || [key];

/** 묶음 이름 — 둘 이상이면 '3370 시리즈', 아니면 호선 번호 그대로. */
export const seriesLabel = (data, key) => (seriesMembers(data, key).length > 1 ? `${key} 시리즈` : key);

/** 묶음의 선종 — 대표 호선 값, 없으면 같은 시리즈 호선 중 처음 있는 값. */
export const seriesShip = (data, key) => {
  const ships = data?.hulls || {};
  return ships[key] || seriesMembers(data, key).map((h) => ships[h]).find(Boolean) || null;
};
