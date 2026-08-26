from collections.abc import Callable, Sequence

from ...logutils import get_logger

logger = get_logger(__name__)


class SnapshotDepth:
    """Reads the accessibility tree shallow, and deep only when shallow missed.

    A capped snapshot is what makes a mobile step affordable — on Path4Life,
    depth 24 takes 5.7s against 20s uncapped. It is also what makes half the app
    invisible: at that depth the home screen reports thirty captions and *no*
    feed rows at all, so an agent asked to open a shiur is looking at an empty
    list and cannot succeed under any wording.

    Paying 20s on every step to fix that is the wrong trade — most steps never
    need the depth. So the rule is: read shallow, and if what the instruction
    named is not in what came back, read once more with the cap off. The cost
    lands on the steps that need it instead of on all of them.

    Deepening is only ever justified by a miss. With nothing named to look for
    the shallow read stands, because "I found nothing" and "there was nothing to
    find" are the same tree.
    """

    def __init__(self, shallow: int, set_depth: Callable[[int | None], None]):
        """
        Args:
            shallow: depth the ordinary read is capped at.
            set_depth: applies a cap to the session; ``None`` removes it.
        """
        self._shallow = shallow
        self._set_depth = set_depth
        self._wanted: list[str] = []
        self._shallow_reads = 0
        self._deep_reads = 0

    @property
    def reads(self) -> dict[str, int]:
        return {"shallow": self._shallow_reads, "deep": self._deep_reads}

    def expect(self, terms: Sequence[str]) -> None:
        """Name what the next reads should contain.

        Set per step from the instruction's own words. Cleared by passing
        nothing, which returns the driver to reading shallow unconditionally.
        """
        self._wanted = [term for term in terms if len(term.strip()) > 1]

    def read(self, fetch_source: Callable[[], str]) -> str:
        shallow = fetch_source()
        self._shallow_reads += 1
        if self._satisfies(shallow):
            return shallow

        logger.debug("Shallow tree does not name what the step asked for, reading deep")
        try:
            self._set_depth(None)
            deep = fetch_source()
            self._deep_reads += 1
            return deep
        finally:
            self._set_depth(self._shallow)

    def _satisfies(self, source: str) -> bool:
        """Whether this tree already shows something the instruction named."""
        if not self._wanted:
            return True
        haystack = source.lower()
        return any(term.lower() in haystack for term in self._wanted)
