import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useApp } from '../../store/app';
import { NEXUS_IA_ATIVA } from '../../store/session';
import { deliverInvite, inviteCodeFromUrl } from '../../lib/invite';
import { openExternal } from '../../lib/platform';

const SAFE_URL = /^(https?:|mailto:|mention:)/i;

function transformUrl(url: string): string {
  return SAFE_URL.test(url) ? url : '';
}

/** Troca @usuario por um link especial que vira um "chip" de menção. */
function linkMentions(text: string, usernames: Map<string, string>): string {
  return text.replace(/(^|[^A-Za-z0-9_.@`[])@([A-Za-z0-9_](?:[A-Za-z0-9_.]{1,30}[A-Za-z0-9_]))/g, (all, pre: string, name: string) => {
    const lower = name.toLowerCase();
    if (NEXUS_IA_ATIVA && (lower === 'claude' || lower === 'nexus')) return `${pre}[@NEXUS IA](mention:claude)`;
    if (lower === 'todos' || lower === 'everyone') return `${pre}[@${name}](mention:todos)`;
    const id = usernames.get(lower);
    return id ? `${pre}[@${name}](mention:${id})` : all;
  });
}

export const MessageContent = memo(function MessageContent({ content, highlightSelf }: { content: string; highlightSelf?: string | null }) {
  const profiles = useApp((s) => s.profiles);
  const setModal = useApp((s) => s.setModal);
  const usernames = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of Object.values(profiles)) m.set(p.username, p.id);
    return m;
  }, [profiles]);

  const source = useMemo(() => linkMentions(content, usernames), [content, usernames]);

  return (
    <div className="nx-md text-[15px] text-[#dfe3ea]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={transformUrl}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('mention:')) {
              const id = href.slice(8);
              const self = id === highlightSelf;
              return (
                <button
                  type="button"
                  onClick={() => {
                    if (id !== 'claude' && id !== 'todos') setModal({ kind: 'profile', userId: id });
                  }}
                  className={`inline rounded px-1 font-medium no-underline ${
                    id === 'claude' ? 'bg-violet/20 text-[#c4b5fd]' : self ? 'bg-warn/20 text-[#fcd34d]' : 'bg-accent/18 text-mention hover:bg-accent/30'
                  }`}
                >
                  {children}
                </button>
              );
            }
            return (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  const code = href ? inviteCodeFromUrl(href) : null;
                  if (code) deliverInvite(code);
                  else if (href) openExternal(href);
                }}
              >
                {children}
              </a>
            );
          },
          img: ({ alt }) => <span className="text-fg-3">[imagem: {alt}]</span>,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});
