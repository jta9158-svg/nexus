"""Regras do Claude na call — as mesmas de supabase/functions/_shared/voice.ts.

Sem dependências, para poder testar (tests/test_policy.py).
"""

from __future__ import annotations

import re

# "Claude" do jeito que a transcrição em português costuma escrever.
# "Cláudio" e "cloud" ficam de fora para não confundir com nomes e termos comuns.
_WAKE = re.compile(r"(?<!\w)(claude|cl[aá]ude|cl[oóô]u?de)(?!\w)", re.IGNORECASE)

MODES = ("quando_chamado", "participante_ativo", "segundo_plano", "hibrido")

GREETING = "Oi, pessoal! Sou o Claude. É só falar meu nome antes da pergunta. Não gravo a conversa."
GOODBYE_PAUSED = "Pausei a escuta. Quando quiserem, é só me liberar de novo."


def is_addressed(text: str | None) -> bool:
    return bool(_WAKE.search(text or ""))


def should_consider(mode: str | None, addressed: bool) -> str:
    """'responder' | 'avaliar' | 'ignorar'."""
    if addressed:
        return "responder"
    return "avaliar" if mode == "participante_ativo" else "ignorar"


def tts_config(voice: str | None, speed: str | None) -> dict:
    """Modelo de voz (LiveKit Inference) conforme a escolha da pessoa."""
    if voice == "voz2":
        rate = {"lenta": 0.85, "rapida": 1.15}.get(speed or "", 1.0)
        return {
            "model": "inworld/inworld-tts-2-flash",
            "extra_kwargs": {"speaking_rate": rate},
            "fallback": "cartesia/sonic-3",
        }
    preset = {"lenta": "slow", "rapida": "fast"}.get(speed or "", "normal")
    return {
        "model": "cartesia/sonic-3",
        "extra_kwargs": {"speed": preset},
        "fallback": "inworld/inworld-tts-2-flash",
    }


def pick_speaker(active: list[str], current: str | None, agent_identity: str, user_speaking: bool) -> str | None:
    """Quem o Claude deve ouvir agora: quem está falando mais alto (menos ele mesmo).

    Não troca no meio da fala de alguém, para não cortar a frase.
    """
    if user_speaking and current:
        return None
    for identity in active:
        if identity and identity != agent_identity:
            return identity if identity != current else None
    return None


def can_command(action: str, sender: str | None, inviter: str | None) -> bool:
    """Qualquer pessoa na call pode pausar ou silenciar (mais privacidade).
    Voltar a ouvir só quem chamou o Claude."""
    if not sender:
        return False
    if action in ("pausar_escuta", "silenciar", "falar"):
        return True
    if action == "retomar_escuta":
        return sender == inviter
    return False
