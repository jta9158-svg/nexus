"""NEXUS — Claude na call (agente de voz).

Roda na LiveKit Cloud. Só entra numa sala quando a função `claude-voice` do
Supabase despacha o agente (agent_name="nexus-claude") — ou seja, quando alguém
autorizado aperta "Chamar o Claude" na call.

O que ele faz:
- ouve quem está falando (troca de pessoa conforme quem fala),
- transcreve com LiveKit Inference (Deepgram Nova-3, português),
- responde quando alguém diz "Claude" (no modo "Participante ativo" pode comentar
  sozinho quando tiver algo útil),
- pede a resposta à função `claude-voice`, que monta o contexto seguro e chama a
  API da Anthropic — a chave do Claude fica só no servidor do NEXUS,
- fala com voz sintetizada e para de falar quando alguém começa a falar.

Não grava áudio e não guarda transcrição. Pode ser pausado, silenciado ou
removido pelos botões da call.
"""

from __future__ import annotations

import asyncio
import codecs
import json
import logging
import os
from collections import deque
from typing import Any

import aiohttp
from livekit import rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    cli,
    inference,
    llm,
    room_io,
)
from livekit.agents.llm import StopResponse
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS, NOT_GIVEN, APIConnectOptions, NotGivenOr
from livekit.plugins import silero

from policy import GREETING, can_command, is_addressed, pick_speaker, should_consider, tts_config

log = logging.getLogger("nexus-claude")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
INTERNAL_SECRET = os.environ.get("NEXUS_INTERNAL_SECRET", "")
FUNCTION_URL = f"{SUPABASE_URL}/functions/v1/claude-voice"
TOPIC = "nexus-claude"
KEYTERMS = ["NEXUS IA", "Claude", "NEXUS", "ALPHA", "Templo da Magia", "Roblox", "Roblox Studio"]


class Brain:
    """Estado da sessão de voz (compartilhado entre o agente e o "LLM")."""

    def __init__(self, meta: dict[str, Any]) -> None:
        self.session_id: str | None = meta.get("session_id")
        self.inviter: str | None = meta.get("inviter_id")
        self.mode: str = meta.get("mode") or "hibrido"
        self.history: deque[dict[str, str]] = deque(maxlen=16)
        self.pending: dict[str, Any] | None = None
        self.paused = False
        self.muted = False
        self.listeners: list[str] = []
        self.http: aiohttp.ClientSession | None = None
        # Usado só sem sala (testes em modo texto)
        self.fallback_speaker: tuple[str | None, str] = (None, "Alguém")

    async def event(self, name: str, detail: str = "") -> None:
        if not self.http or not self.session_id:
            return
        try:
            async with self.http.post(
                FUNCTION_URL,
                json={"action": "event", "session_id": self.session_id, "event": name, "detail": detail[:300]},
                headers={"x-nexus-internal": INTERNAL_SECRET},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                await resp.read()
        except Exception:  # noqa: BLE001 — avisar o servidor é melhor esforço
            log.warning("não consegui avisar o servidor (%s)", name)


class NexusLLM(llm.LLM):
    """Ponte para a função claude-voice: ela monta o contexto e chama o Claude."""

    def __init__(self, brain: Brain) -> None:
        super().__init__()
        self._brain = brain

    @property
    def model(self) -> str:
        return "claude-via-nexus"

    @property
    def provider(self) -> str:
        return "nexus"

    def chat(
        self,
        *,
        chat_ctx: llm.ChatContext,
        tools: list[llm.Tool] | None = None,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
        parallel_tool_calls: NotGivenOr[bool] = NOT_GIVEN,
        tool_choice: NotGivenOr[llm.ToolChoice] = NOT_GIVEN,
        extra_kwargs: NotGivenOr[dict[str, Any]] = NOT_GIVEN,
    ) -> NexusLLMStream:
        return NexusLLMStream(self, brain=self._brain, chat_ctx=chat_ctx, tools=tools or [], conn_options=conn_options)


class NexusLLMStream(llm.LLMStream):
    def __init__(self, owner: NexusLLM, *, brain: Brain, chat_ctx: llm.ChatContext, tools: list[llm.Tool], conn_options: APIConnectOptions) -> None:
        super().__init__(owner, chat_ctx=chat_ctx, tools=tools, conn_options=conn_options)
        self._brain = brain
        # Nunca repetir uma fala já começada
        self._retry_on_chunk_sent = False

    def _say(self, text: str) -> None:
        self._event_ch.send_nowait(llm.ChatChunk(id=self._brain.session_id or "nexus", delta=llm.ChoiceDelta(role="assistant", content=text)))

    async def _run(self) -> None:
        pending, self._brain.pending = self._brain.pending, None
        if not pending or not self._brain.http:
            return
        payload = {
            "action": "reply",
            "session_id": self._brain.session_id,
            "speaker_id": pending["speaker_id"],
            "text": pending["text"],
            "history": pending["history"],
            "listeners": self._brain.listeners,
            "addressed": pending["addressed"],
        }
        try:
            async with self._brain.http.post(
                FUNCTION_URL,
                json=payload,
                headers={"x-nexus-internal": INTERNAL_SECRET},
                timeout=aiohttp.ClientTimeout(total=90, sock_read=40),
            ) as resp:
                if resp.status != 200:
                    body = (await resp.text())[:200]
                    log.warning("claude-voice respondeu %s: %s", resp.status, body)
                    if pending["addressed"]:
                        self._say("Desculpa, não consegui responder agora.")
                    return
                decoder = codecs.getincrementaldecoder("utf-8")()
                async for chunk in resp.content.iter_any():
                    text = decoder.decode(chunk)
                    if text:
                        self._say(text)
                tail = decoder.decode(b"", final=True)
                if tail:
                    self._say(tail)
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            log.warning("falha ao falar com o servidor: %s", err)
            if pending["addressed"]:
                self._say("Perdi a conexão com o servidor do NEXUS por um instante. Pode repetir?")


class NexusClaude(Agent):
    def __init__(self, brain: Brain) -> None:
        super().__init__(instructions="NEXUS IA (feita com o Claude) na call; as instruções completas ficam no servidor.")
        self.brain = brain

    def _speaker(self) -> tuple[str | None, str]:
        try:
            p = self.session.room_io.linked_participant
        except RuntimeError:  # sem sala (testes em modo texto)
            p = None
        if p is not None:
            return p.identity, p.name or "Alguém"
        return self.brain.fallback_speaker

    async def on_user_turn_completed(self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage) -> None:
        text = (new_message.text_content or "").strip()
        if not text:
            raise StopResponse()
        speaker_id, speaker_name = self._speaker()
        addressed = is_addressed(text)
        decision = should_consider(self.brain.mode, addressed)
        # Só metadados (nada do conteúdo da conversa vai para os registros).
        log.info(
            "fala recebida",
            extra={"chamou": addressed, "decisao": decision, "letras": len(text), "pausado": self.brain.paused, "mudo": self.brain.muted},
        )
        prior = list(self.brain.history)
        self.brain.history.append({"role": "user", "speaker": speaker_name, "text": text})
        if self.brain.paused or self.brain.muted or decision == "ignorar" or not speaker_id:
            raise StopResponse()
        self.brain.pending = {"speaker_id": speaker_id, "text": text, "addressed": addressed, "history": prior}


server = AgentServer()


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


def humans(room: rtc.Room) -> list[rtc.RemoteParticipant]:
    return [p for p in room.remote_participants.values() if p.kind != rtc.ParticipantKind.PARTICIPANT_KIND_AGENT]


@server.rtc_session(agent_name="nexus-claude")
async def entrypoint(ctx: JobContext) -> None:
    meta: dict[str, Any] = json.loads(ctx.job.metadata or "{}")
    brain = Brain(meta)
    brain.http = aiohttp.ClientSession()

    async def close_http() -> None:
        await brain.event("left", "Saiu da call")
        if brain.http:
            await brain.http.close()

    ctx.add_shutdown_callback(close_http)

    if not SUPABASE_URL or not INTERNAL_SECRET:
        await brain.event("error", "Agente sem SUPABASE_URL/NEXUS_INTERNAL_SECRET")
        ctx.shutdown("configuração incompleta")
        return

    await ctx.connect()

    voice = tts_config(meta.get("voice"), meta.get("speed"))
    session = AgentSession(
        stt=inference.STT(
            model="deepgram/nova-3",
            language="pt-BR",
            extra_kwargs={"keyterm": KEYTERMS, "smart_format": True},
        ),
        vad=ctx.proc.userdata["vad"],
        llm=NexusLLM(brain),
        tts=inference.TTS(
            model=voice["model"],
            language="pt",
            extra_kwargs=voice["extra_kwargs"],
            fallback=[voice["fallback"]],
        ),
        turn_handling={
            "endpointing": {"min_delay": 1.0},
            "interruption": {"enabled": True, "min_duration": 0.4},
        },
        user_away_timeout=None,
    )

    def refresh_listeners() -> None:
        brain.listeners = [p.identity for p in humans(ctx.room)]

    @session.on("conversation_item_added")
    def on_item(ev: Any) -> None:
        item = ev.item
        if getattr(item, "role", None) == "assistant":
            text = (getattr(item, "text_content", None) or "").strip()
            if text:
                brain.history.append({"role": "assistant", "text": text})

    @ctx.room.on("active_speakers_changed")
    def on_speakers(speakers: list[rtc.Participant]) -> None:
        if brain.paused:
            return
        linked = session.room_io.linked_participant
        target = pick_speaker(
            [p.identity for p in speakers if p.kind != rtc.ParticipantKind.PARTICIPANT_KIND_AGENT],
            linked.identity if linked else None,
            ctx.room.local_participant.identity,
            session.user_state == "speaking",
        )
        if target:
            session.room_io.set_participant(target)

    @ctx.room.on("participant_connected")
    def on_join(_: rtc.RemoteParticipant) -> None:
        refresh_listeners()

    @ctx.room.on("participant_disconnected")
    def on_leave(p: rtc.RemoteParticipant) -> None:
        refresh_listeners()
        # Quem chamou saiu, ou não sobrou ninguém: o Claude sai também.
        if p.identity == brain.inviter or not brain.listeners:
            ctx.shutdown("quem chamou saiu da call")

    async def set_flags() -> None:
        await ctx.room.local_participant.set_attributes(
            {"nexus.escuta": "pausada" if brain.paused else "ativa", "nexus.voz": "silenciada" if brain.muted else "ativa"}
        )

    @ctx.room.on("data_received")
    def on_data(packet: rtc.DataPacket) -> None:
        if packet.topic != TOPIC or packet.participant is None:
            return
        try:
            action = json.loads(packet.data.decode("utf-8")).get("action", "")
        except (ValueError, UnicodeDecodeError):
            return
        if not can_command(action, packet.participant.identity, brain.inviter):
            return
        if action == "pausar_escuta":
            brain.paused = True
            session.input.set_audio_enabled(False)
            session.interrupt()
        elif action == "retomar_escuta":
            brain.paused = False
            session.input.set_audio_enabled(True)
        elif action == "silenciar":
            brain.muted = True
            session.interrupt()
        elif action == "falar":
            brain.muted = False
        asyncio.ensure_future(set_flags())

    await session.start(
        agent=NexusClaude(brain),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            participant_identity=brain.inviter or NOT_GIVEN,
            close_on_disconnect=False,
            text_input=False,
            text_output=False,
        ),
    )
    refresh_listeners()
    await set_flags()
    await brain.event("joined")
    if meta.get("greeting", True):
        session.say(GREETING, allow_interruptions=True, add_to_chat_ctx=False)


if __name__ == "__main__":
    cli.run_app(server)
