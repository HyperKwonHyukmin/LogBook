import { useContext, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { AuthContext } from '../auth/AuthContext.jsx';
import { isAdminLevel, teamChoices } from './levels.js';

/** 74 — 관리자용 팀 목록(한 번 받아 둔다). 팀을 바꾸면 invalidateTeams(). */
let cache = null;
export function invalidateTeams() { cache = null; }
function loadTeams() {
  if (!cache) cache = api('/admin/teams').catch(() => { cache = null; return []; });
  return cache;
}

/** 공개 범위 고르기에 보일 팀 {id, name} 목록 — 관리자는 모든 팀, 팀원은 자기 팀, 그 밖에는 빈 목록. */
export function useTeamChoices(item) {
  const user = useContext(AuthContext)?.user || null;
  const admin = isAdminLevel(user);
  const [teams, setTeams] = useState([]);
  useEffect(() => {
    if (!admin) return undefined;
    let alive = true;
    loadTeams().then((rows) => { if (alive) setTeams((rows || []).map((t) => ({ id: t.id, name: t.name }))); });
    return () => { alive = false; };
  }, [admin]);
  return teamChoices(user, teams, item);
}
