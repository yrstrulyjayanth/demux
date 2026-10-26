from faster_whisper.transcribe import Segment, Word
seg = Segment(
    id=1,
    seek=0,
    start=0.0,
    end=1.0,
    text="hello",
    tokens=[],
    temperature=0.0,
    avg_logprob=0.0,
    compression_ratio=0.0,
    no_speech_prob=0.0,
    words=[Word(start=0.0, end=1.0, word="hello", probability=1.0)]
)
print(getattr(seg, "words", None))
