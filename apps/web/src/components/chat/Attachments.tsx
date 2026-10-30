import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileArchive, FileCode2, FileText, Film, Image as ImageIcon, Music, X } from 'lucide-react';
import { signedUrl } from '../../lib/storage';
import { formatBytes } from '../../lib/format';
import { openExternal } from '../../lib/platform';
import { toast } from '../../store/toast';
import type { Attachment } from '../../types/db';
import { Spinner } from '../ui';

function iconFor(a: Attachment) {
  if (a.type.startsWith('image/')) return <ImageIcon className="size-5" />;
  if (a.type.startsWith('video/')) return <Film className="size-5" />;
  if (a.type.startsWith('audio/')) return <Music className="size-5" />;
  if (/zip|rar|7z|tar|gzip/.test(a.type) || /\.(zip|rar|7z|rbxm|rbxl)$/i.test(a.name)) return <FileArchive className="size-5" />;
  if (/\.(lua|luau|js|ts|py|json)$/i.test(a.name)) return <FileCode2 className="size-5" />;
  return <FileText className="size-5" />;
}

async function download(a: Attachment) {
  try {
    const url = await signedUrl('attachments', a.path, { download: a.name });
    openExternal(url);
  } catch (err) {
    toast.error(err, 'Não foi possível baixar');
  }
}

function ImageAttachment({ a }: { a: Attachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!a.path) return;
    signedUrl('attachments', a.path)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [a.path]);

  const ratio = a.width && a.height ? a.width / a.height : 4 / 3;
  const w = Math.min(400, a.width ?? 400);
  const h = Math.min(300, w / ratio);

  if (failed) return <FileCard a={a} />;
  return (
    <>
      <button
        onClick={() => url && setOpen(true)}
        className="block rounded-xl overflow-hidden border border-line bg-[#0d1118] max-w-full"
        style={{ width: Math.min(w, h * ratio), aspectRatio: String(ratio) }}
        aria-label={`Abrir imagem ${a.name}`}
      >
        {url ? <img src={url} alt={a.name} className="size-full object-cover" loading="lazy" /> : <div className="size-full flex items-center justify-center"><Spinner /></div>}
      </button>
      {open && url
        ? createPortal(
            <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 animate-fade-in" onClick={() => setOpen(false)}>
              <img src={url} alt={a.name} className="max-w-full max-h-full rounded-lg shadow-2xl" />
              <div className="absolute top-4 right-4 flex gap-2">
                <button className="size-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center" onClick={(e) => { e.stopPropagation(); void download(a); }} aria-label="Baixar">
                  <Download className="size-5" />
                </button>
                <button className="size-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center" aria-label="Fechar">
                  <X className="size-5" />
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function FileCard({ a }: { a: Attachment }) {
  return (
    <div className="flex items-center gap-3 w-full max-w-[408px] rounded-xl border border-line bg-[#151a24] px-3.5 py-3">
      <div className="size-10 rounded-lg bg-[#0d1118] border border-line flex items-center justify-center text-fg-2 shrink-0">{iconFor(a)}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[14.5px] text-fg truncate">{a.name}</div>
        <div className="text-[12px] text-fg-3">{formatBytes(a.size)}</div>
      </div>
      {a.path ? (
        <button onClick={() => void download(a)} className="size-9 rounded-lg text-fg-2 hover:text-fg hover:bg-raised flex items-center justify-center" aria-label={`Baixar ${a.name}`}>
          <Download className="size-[18px]" />
        </button>
      ) : (
        <Spinner className="size-4" />
      )}
    </div>
  );
}

export function Attachments({ items }: { items: Attachment[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {items.map((a, i) =>
        a.type.startsWith('image/') && a.path ? <ImageAttachment key={a.path || i} a={a} /> : <FileCard key={a.path || i} a={a} />,
      )}
    </div>
  );
}
