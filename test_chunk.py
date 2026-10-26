import sys
from backend.utils.whisper_utils import chunk_words, SegObj
from dataclasses import dataclass

@dataclass
class MockWord:
    start: float
    end: float
    word: str

words = [
    MockWord(0.0, 0.5, "This"),
    MockWord(0.5, 1.0, "is"),
    MockWord(1.0, 1.5, "a"),
    MockWord(1.5, 2.0, "test"),
    MockWord(2.0, 2.5, "of"),
    MockWord(2.5, 3.0, "the"),
    MockWord(3.0, 3.5, "system."),
]

res = chunk_words(words)
for r in res:
    print(r)
