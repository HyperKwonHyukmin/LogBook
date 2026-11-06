import { describe, expect, it } from 'vitest';
import { initialChecked, isFolderUpload, planFolder, previewDrafts, skippedByExt } from './folderPlan.js';

const item = (relPath, size = 10) => ({ file: { size }, relPath });

// 2026-11-05 조사한 실제 구성(…\과거 과제 자료\2025) 일부
const Y2025 = [
  '2025/closed_chock/보고서_Closed chock 강도해석_R1.pdf',
  '2025/closed_chock/보고서_Closed chock 강도해석_R1.pptx',
  '2025/closed_chock/Result_M1_90ton/M1_Chock_90ton.bdf',
  '2025/closed_chock/Result_M1_90ton/m1_chock_90ton.op2',
  '2025/closed_chock/Result_M1_92ton/Original/m1_92ton.f06',
  '2025/closed_chock/Result_M1_92ton/Original/Ressult_M1_92ton.mvw',
  '2025/manifold_support_8182/doc/report.pdf',
  '2025/manifold_support_8182/doc/calc.xlsm',
  '2025/manifold_support_8182/fe_model/model.bdf',
  '2025/manifold_support_8182/fe_model/~$calc.xlsm',
].map((p) => item(p));

describe('planFolder', () => {
  it('제외 추천 형식(op2·f06·mvw)은 처음에 체크가 풀리고, 엑셀은 체크된다', () => {
    const plan = planFolder(Y2025);
    const checked = initialChecked(plan);
    expect(checked.has('2025/closed_chock/Result_M1_90ton/m1_chock_90ton.op2')).toBe(false);
    expect(checked.has('2025/closed_chock/Result_M1_92ton/Original/Ressult_M1_92ton.mvw')).toBe(false);
    expect(checked.has('2025/manifold_support_8182/doc/calc.xlsm')).toBe(true);
    expect(checked.has('2025/closed_chock/Result_M1_92ton/Original/m1_92ton.f06')).toBe(false);   // 2026-11-05 사용자 결정
    expect(skippedByExt(plan, checked)).toEqual([{ ext: '.op2', count: 1 }, { ext: '.f06', count: 1 }, { ext: '.mvw', count: 1 }]);
  });

  it('임시 파일은 목록에 넣지 않고 따로 센다', () => {
    const plan = planFolder(Y2025);
    expect(plan.junk).toEqual(['2025/manifold_support_8182/fe_model/~$calc.xlsm']);
    expect(plan.files).toHaveLength(9);
  });

  it('파일은 소속 폴더별로 묶인다', () => {
    const plan = planFolder(Y2025);
    expect(plan.groups.map((g) => g.dir)).toEqual([
      '2025/closed_chock', '2025/closed_chock/Result_M1_90ton', '2025/closed_chock/Result_M1_92ton/Original',
      '2025/manifold_support_8182/doc', '2025/manifold_support_8182/fe_model',
    ]);
  });

  it('하위 폴더마다 나누면 과제 폴더마다 1건, 나누지 않으면 전체 1건', () => {
    const plan = planFolder(Y2025);
    expect(plan.root).toBe('2025');
    expect(previewDrafts(plan, initialChecked(plan), false).map((d) => [d.name, d.count])).toEqual([['2025', 6]]);
    expect(previewDrafts(plan, initialChecked(plan), true).map((d) => [d.name, d.count]))
      .toEqual([['closed chock', 3], ['manifold support 8182', 3]]);
  });

  it('과제 폴더 하나(closed_chock)를 전체 1건으로', () => {
    const one = Y2025.filter((i) => i.relPath.startsWith('2025/closed_chock/'))
      .map((i) => item(i.relPath.replace('2025/', '')));
    const plan = planFolder(one);
    expect(plan.root).toBe('closed_chock');
    expect(previewDrafts(plan, initialChecked(plan), false)).toEqual([{ name: 'closed chock', count: 3, size: 30 }]);
  });

  it('체크한 것이 없으면 초안도 없다', () => {
    expect(previewDrafts(planFolder(Y2025), new Set(), true)).toEqual([]);
  });

  it('폴더에서 온 파일이 있을 때만 목록을 띄운다', () => {
    expect(isFolderUpload([item('a.bdf')])).toBe(false);
    expect(isFolderUpload(Y2025)).toBe(true);
  });
});

describe('Abaqus 제외 추천(2026-11-06)', () => {
  const mk = (relPath) => ({ relPath, file: { size: 1 } });

  it('.inp 만 체크하고 부산물은 푼다. .dat 은 같은 폴더에 같은 이름 .inp 가 있을 때만 푼다', () => {
    const plan = planFolder([
      mk('job/rudder.inp'), mk('job/rudder.dat'), mk('job/rudder.sta'), mk('job/rudder.msg'), mk('job/rudder.prt'),
      mk('job/rudder.sim'), mk('job/rudder.ipm'), mk('job/rudder.odb'),
      mk('job/nastran/model.dat'), mk('job/other.dat'),
    ]);
    expect([...initialChecked(plan)].sort()).toEqual(['job/nastran/model.dat', 'job/other.dat', 'job/rudder.inp']);
  });
});
