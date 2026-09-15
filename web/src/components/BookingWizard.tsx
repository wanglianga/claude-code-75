import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { api, ApiError } from '../api';
import type { SlotResult } from '../types';
import { Section, Field, Pill, RiskBadge, AlertList, Empty } from './ui';
import { EQUIP_STATUS } from '../labels';

/**
 * 预约向导：选择患者 → 器械 → 时长 → 生成可预约时段 → 确认
 * 时段由后端依据 器械状态/治疗师排班/患者风险/训练时长/上轮反馈 生成
 */
export function BookingWizard() {
  const { data, meta, call, toast, bookingIntent, setBookingIntent } = useStore();
  const [patientId, setPatientId] = useState(bookingIntent?.patientId || '');
  const [equipmentId, setEquipmentId] = useState(bookingIntent?.equipmentId || '');
  const [duration, setDuration] = useState<number>(0);
  const [result, setResult] = useState<SlotResult | null>(null);
  const [picked, setPicked] = useState<{ date: string; start: string } | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selfPayConfirm, setSelfPayConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (bookingIntent) {
      setPatientId(bookingIntent.patientId);
      if (bookingIntent.equipmentId) setEquipmentId(bookingIntent.equipmentId);
      setBookingIntent(null);
    }
  }, [bookingIntent, setBookingIntent]);

  const patient = data?.patients.find((p) => p.id === patientId);
  const cat = patient && meta?.categories[patient.category];
  const therapist = patient && data?.therapists.find((t) => t.id === patient.therapistId);
  const lastDone = useMemo(() => patient && (data?.appointments || [])
    .filter((a) => a.patientId === patient.id && a.status === 'completed')
    .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start))[0], [data, patient]);

  useEffect(() => {
    if (cat && !duration) setDuration(cat.defaultDuration);
  }, [patientId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPicked(null);
    setResult(null);
    if (!patientId || !equipmentId) return;
    let dead = false;
    setLoadingSlots(true);
    api<SlotResult>('/appointments/slots', { body: { patientId, equipmentId, duration: duration || undefined } })
      .then((r) => { if (!dead) setResult(r); })
      .catch((e) => { if (!dead) toast(e.message, 'err'); })
      .finally(() => { if (!dead) setLoadingSlots(false); });
    return () => { dead = true; };
  }, [patientId, equipmentId, duration]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || !meta) return null;

  const submit = async (allowSelfPay = false) => {
    if (!picked) return;
    try {
      await api('/appointments', { body: { patientId, equipmentId, date: picked.date, start: picked.start, duration: result?.duration || duration, allowSelfPay } });
      toast('预约成功', 'ok');
      setPicked(null);
      setResult(null);
      setSelfPayConfirm(null);
      await useStore.getState().reload();
      // 重新拉取时段
      const r = await api<SlotResult>('/appointments/slots', { body: { patientId, equipmentId, duration: duration || undefined } });
      setResult(r);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INSURANCE_SHORTAGE') {
        setSelfPayConfirm(e.message);
      } else {
        toast(e instanceof Error ? e.message : '预约失败', 'err');
      }
    }
  };

  const byDate = new Map<string, { date: string; start: string; end: string }[]>();
  for (const s of result?.slots || []) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date)!.push(s);
  }

  return (
    <Section title="预约训练（时段由器械、治疗师排班、患者风险、时长与上轮反馈综合生成）">
      <div className="grid2">
        <Field label="选择患者">
          <select value={patientId} onChange={(e) => { setPatientId(e.target.value); setDuration(0); }}>
            <option value="">请选择</option>
            {data.patients.map((p) => <option key={p.id} value={p.id}>{p.name}（{meta.categories[p.category]?.label} · 风险{p.riskLevel}）</option>)}
          </select>
        </Field>
        <Field label="选择器械" hint={patient ? `负责治疗师：${therapist?.name || '未分配'}（按治疗师排班生成时段）` : undefined}>
          <select value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}>
            <option value="">请选择</option>
            {data.equipment.map((eq) => {
              const [label] = EQUIP_STATUS[eq.status] || [eq.status];
              const unsuitable = patient && eq.suitableCategories.length > 0 && !eq.suitableCategories.includes(patient.category);
              return <option key={eq.id} value={eq.id} disabled={eq.status !== 'available'}>{eq.name}（{eq.type} · {label}{unsuitable ? ' · 非适用人群' : ''}）</option>;
            })}
          </select>
        </Field>
      </div>

      {patient && (
        <div className="patient-strip">
          <span><b>{patient.name}</b> <Pill tone="blue">{cat?.label}</Pill> <RiskBadge level={patient.riskLevel} /></span>
          <span>疼痛 {patient.painScore} 分</span>
          <span>禁忌：{patient.contraindications.join('、') || '无'}</span>
          <span>医保：{patient.insuranceItems.map((it) => `${it.name} ${it.used}/${it.total}`).join('；') || '无'}</span>
          {patient.familyAccompany && <Pill tone="purple">需家属陪同</Pill>}
        </div>
      )}
      {patient && lastDone?.feedback && (
        <div className="note-box">
          上轮反馈（{lastDone.date}）：疗效 {lastDone.feedback.effect || '—'}，训练后疼痛 {lastDone.feedback.painAfter ?? '—'} 分
          {lastDone.feedback.delayedPain && `，延迟疼痛 ${lastDone.feedback.delayedPain.pain} 分`}
          {lastDone.feedback.note && `；${lastDone.feedback.note}`}
        </div>
      )}
      {patient && (
        <div className="grid2">
          <Field label="训练时长（分钟）" hint={`${cat?.label}默认 ${cat?.defaultDuration} 分钟`}>
            <input type="number" min={15} max={120} step={5} value={duration || cat?.defaultDuration || 45} onChange={(e) => setDuration(Number(e.target.value))} />
          </Field>
        </div>
      )}

      {result && result.warnings.length > 0 && <AlertList items={result.warnings} tone="amber" />}
      {loadingSlots && <div className="muted">正在生成可预约时段…</div>}
      {result && !loadingSlots && (
        result.slots.length === 0 ? <Empty>近7天无可预约时段（可调整时长或更换器械）</Empty> : (
          <div className="slot-days">
            {[...byDate.entries()].map(([date, slots]) => (
              <div key={date} className="slot-day">
                <div className="slot-date">{date}</div>
                <div className="slot-grid">
                  {slots.map((s) => {
                    const active = picked?.date === s.date && picked?.start === s.start;
                    return <button key={s.start} className={`slot ${active ? 'slot-active' : ''}`} onClick={() => setPicked({ date: s.date, start: s.start })}>{s.start}</button>;
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      )}
      {picked && patient && (
        <div className="confirm-bar">
          <span>确认预约：<b>{patient.name}</b> · {picked.date} {picked.start}（{result?.duration || duration}分钟）· {data.equipment.find((e) => e.id === equipmentId)?.name} · 治疗师 {therapist?.name}</span>
          <button className="btn btn-primary" onClick={() => submit(false)}>确认预约</button>
        </div>
      )}
      {selfPayConfirm && (
        <div className="alert-list tone-red">
          <div>⚠ {selfPayConfirm}</div>
          <div className="row-actions mt4">
            <button className="btn btn-danger" onClick={() => submit(true)}>仍要预约（按自费，生成医保协同事件）</button>
            <button className="btn" onClick={() => setSelfPayConfirm(null)}>取消</button>
          </div>
        </div>
      )}
    </Section>
  );
}
