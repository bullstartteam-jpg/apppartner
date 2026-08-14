import { useState, useEffect } from 'react';
import api from '../services/api';
import { notify } from './Dialog';

// Ticket threads a partner may read: platform 1 (raised by the seller) and
// platform 2 (partner↔staff), both only on orders assigned to them. The API
// enforces that, so nothing here filters by role.
export const TICKET_STATUS = {
  1: { label: 'Đang mở', cls: 'bg-blue-100 text-blue-700' },
  2: { label: 'Đã xong', cls: 'bg-emerald-100 text-emerald-700' },
  3: { label: 'Tin mới', cls: 'bg-orange-100 text-orange-700' },
};
export const TICKET_PLATFORM = { 1: 'Seller', 2: 'Partner' };

export function TicketStatusPill({ status }) {
  const s = TICKET_STATUS[status] || TICKET_STATUS[1];
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

export const fmtTime = (t) => (t ? new Date(t).toLocaleString() : '—');

function Shell({ title, sub, onClose, children, footer, wide = false }) {
  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
      <div onClick={e => e.stopPropagation()}
        className={`bg-white rounded-xl shadow-xl w-[90vw] ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[85vh] flex flex-col overflow-hidden`}>
        <div className="px-4 py-3 border-b border-neutral-200 flex justify-between items-start gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-neutral-800 truncate">{title}</h3>
            {sub}
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-800 text-xl leading-none shrink-0">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">{children}</div>
        {footer}
      </div>
    </div>
  );
}

/** Read a thread and reply to it. */
export function TicketThreadModal({ id, onClose, onChanged }) {
  const [ticket, setTicket] = useState(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const res = await api.get(`/tickets/${id}`);
      setTicket(res.data.ticket);
    } catch (err) {
      notify(err?.response?.data?.message || 'Không mở được ticket', { title: 'Ticket', kind: 'error' });
      onClose();
    }
  };
  useEffect(() => { load(); }, [id]);

  const send = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await api.post(`/tickets/${id}/reply`, { content: reply.trim() });
      setReply('');
      await load();
      onChanged?.();
    } catch (err) {
      notify(err?.response?.data?.message || 'Gửi thất bại', { title: 'Ticket', kind: 'error' });
    } finally { setBusy(false); }
  };

  // Opening message is tickets.content; ticket_items holds only replies.
  const thread = ticket
    ? [{ id: 'root', content: ticket.content, sender: ticket.creator, created_at: ticket.created_at }, ...(ticket.items || [])]
    : [];

  return (
    <Shell
      wide
      title={ticket?.subject || 'Đang tải…'}
      sub={ticket && (
        <div className="text-xs text-neutral-500 flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="font-mono text-orange-500">{ticket.order?.system_id || `#${ticket.order_id}`}</span>
          <span>·</span>
          <span>{TICKET_PLATFORM[ticket.platform]}</span>
          <span>·</span>
          <TicketStatusPill status={ticket.status} />
        </div>
      )}
      onClose={onClose}
      footer={ticket && (
        <div className="border-t border-neutral-200 p-3 space-y-2">
          <textarea value={reply} onChange={e => setReply(e.target.value)} rows={3} placeholder="Trả lời…"
            className="w-full px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm resize-y" />
          <div className="flex justify-end">
            <button onClick={send} disabled={busy || !reply.trim()}
              className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm rounded-lg">
              {busy ? 'Đang gửi…' : 'Gửi'}
            </button>
          </div>
        </div>
      )}
    >
      {!ticket ? (
        <p className="text-neutral-400 text-sm">Đang tải…</p>
      ) : (
        <>
          {thread.map(m => (
            <div key={m.id} className="border border-neutral-200 rounded-lg p-3">
              <div className="flex justify-between items-center text-xs text-neutral-500 mb-1 gap-2">
                <span className="font-medium text-neutral-700 truncate">{m.sender?.name || '—'}</span>
                <span className="shrink-0">{fmtTime(m.created_at)}</span>
              </div>
              <div className="text-sm text-neutral-800 whitespace-pre-wrap break-words">{m.content}</div>
            </div>
          ))}
          {ticket.status === 2 && (
            <p className="text-xs text-neutral-500">
              Ticket đã được đánh dấu xong · {fmtTime(ticket.solved_at)}. Gửi tin mới sẽ mở lại ticket.
            </p>
          )}
        </>
      )}
    </Shell>
  );
}

/**
 * Open a thread on one order. No platform picker: the API derives it from the
 * caller's role, so everything raised from this app is platform 2 — visible to
 * staff and partners, never to the seller.
 */
export function CreateTicketModal({ orderId, systemId, onClose, onCreated }) {
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!subject.trim() || !content.trim()) return;
    setBusy(true);
    try {
      const res = await api.post('/tickets', {
        order_id: orderId,
        subject: subject.trim(),
        content: content.trim(),
      });
      notify('Đã tạo ticket', { title: 'Ticket', kind: 'success' });
      onCreated?.(res.data.ticket);
      onClose();
    } catch (err) {
      notify(err?.response?.data?.message || 'Tạo ticket thất bại', { title: 'Ticket', kind: 'error' });
    } finally { setBusy(false); }
  };

  return (
    <Shell
      title="Tạo ticket"
      sub={<div className="text-xs text-neutral-500 mt-0.5">Đơn <span className="font-mono text-orange-500">{systemId || `#${orderId}`}</span></div>}
      onClose={onClose}
      footer={
        <div className="border-t border-neutral-200 p-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Huỷ</button>
          <button onClick={submit} disabled={busy || !subject.trim() || !content.trim()}
            className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm rounded-lg">
            {busy ? 'Đang tạo…' : 'Tạo ticket'}
          </button>
        </div>
      }
    >
      <p className="text-xs rounded-lg px-3 py-2 bg-[#faf8f6] border border-neutral-200 text-neutral-600">
        Ticket tạo ở đây chỉ <b>admin và partner</b> đọc được — seller của đơn không thấy.
      </p>
      <div>
        <label className="text-xs text-neutral-500 block">Tiêu đề</label>
        <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={255}
          className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
      </div>
      <div>
        <label className="text-xs text-neutral-500 block">Nội dung</label>
        <textarea value={content} onChange={e => setContent(e.target.value)} rows={6}
          className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm resize-y" />
      </div>
    </Shell>
  );
}
