import { useStore } from '../store';
import type { InsuranceConfirmation } from '../types';
import { CONFIRM_STATUS, fmtDT } from '../labels';
import { Pill, StatusPill } from './ui';

/** 患者当前未闭环的医保确认单（预约页/患者页提示用） */
export function useOpenConfirmation(patientId?: string | null): InsuranceConfirmation | null {
  const data = useStore((s) => s.data);
  if (!patientId || !data) return null;
  return (data.confirmations || []).find((c) => c.patientId === patientId
    && ['pending_advice', 'pending_family'].includes(c.status)) || null;
}

/** 医保次数不足提示条：剩余次数 / 自费价格 / 医生续开建议 / 家属确认状态 */
export function InsuranceWarnPanel({ c }: { c: InsuranceConfirmation }) {
  return (
    <div className="alert-list tone-amber ins-warn">
      <div>
        ⚠ 医保项目「{c.insuranceItem}」<b>仅剩 {c.remaining} 次</b>，即将用尽。自费价格 <b>¥{c.selfPayPrice}/次</b>。
        <StatusPill dict={CONFIRM_STATUS} value={c.status} />
      </div>
      <div>
        医生续开建议：{c.doctorAdvice
          ? <b>{c.doctorAdvice}</b>
          : <span className="muted">待医生填写（医生端已收到提醒）</span>}
        {c.doctorAdviceBy && <span className="muted">（{c.doctorAdviceBy} · {fmtDT(c.doctorAdviceAt)}）</span>}
      </div>
      <div className="muted">
        {c.status === 'pending_family'
          ? '等待家属确认：家属在「医保确认」中选择是否自费继续训练，确认结果将同步前台收费与治疗师计划。'
          : '流程：医生续开建议 → 家属确认是否自费 → 确认结果同步前台收费与治疗师计划。'}
      </div>
    </div>
  );
}

/** 确认单详情（确认人/金额/治疗师说明/暂停原因 留痕展示） */
export function ConfirmationDetail({ c, showPatient }: { c: InsuranceConfirmation; showPatient?: boolean }) {
  const data = useStore((s) => s.data);
  const billing = (data?.billing || []).filter((b) => b.confirmationId === c.id);
  return (
    <div className="ins-conf-card">
      <div className="row-between">
        <div>
          {showPatient && <b>{c.patientName}　</b>}
          <b>「{c.insuranceItem}」</b> 剩余 {c.remaining} 次 · 自费 ¥{c.selfPayPrice}/次
        </div>
        <StatusPill dict={CONFIRM_STATUS} value={c.status} />
      </div>
      <div className="muted">发起：{fmtDT(c.createdAt)}</div>
      {c.doctorAdvice && (
        <div className="note-box doctor-advice"><b>医生续开建议：</b>{c.doctorAdvice}
          <span className="muted">（{c.doctorAdviceBy} · {fmtDT(c.doctorAdviceAt)}）</span></div>
      )}
      {c.status === 'confirmed' && (
        <div className="note-box">
          <b>家属确认自费：</b>确认人 <b>{c.confirmerName}</b> · {c.confirmSessions} 次 · 金额 <b>¥{c.confirmAmount}</b> · {fmtDT(c.decidedAt)}
          <div>治疗师说明：{c.therapistNote
            ? <><b>{c.therapistNote}</b><span className="muted">（{c.therapistNoteBy}）</span></>
            : <span className="muted">待治疗师补充</span>}</div>
          {billing.length > 0 && (
            <div className="muted">收费记录：{billing.map((b) => `¥${b.amount}（${b.status === 'paid' ? '已收费' : '待收费'}）`).join('；')}</div>
          )}
        </div>
      )}
      {c.status === 'rejected' && (
        <div className="alert-list tone-red">
          <div>⚠ 家属不同意自费，训练已暂停。暂停原因：<b>{c.pauseReason}</b>（{fmtDT(c.decidedAt)}）—— 等待医生评估是否重开项目。</div>
        </div>
      )}
      {c.status === 'reopened' && (
        <div className="note-box"><Pill tone="purple">医生已重开项目</Pill> 此前暂停原因：{c.pauseReason || '—'}，新医保周期已生效，计划已衔接。</div>
      )}
    </div>
  );
}
