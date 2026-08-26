from dataclasses import dataclass
from typing import Any


@dataclass
class AccessibilityElement:
    id: int | None = None
    backend_node_id: int | None = None
    name: str | None = None
    label: str | None = None
    type: str | None = None
    value: str | None = None
    androidresourceid: str | None = None
    androidclass: str | None = None
    androidtext: str | None = None
    androidcontentdesc: str | None = None
    androidbounds: str | None = None
    frame: Any | None = None  # Playwright Frame object for iframe support
    frame_chain: list[int] | None = None  # For Selenium: chain of iframe backendNodeIds from root to element's frame
    # Position among the elements a locator built from this one would match, in
    # document order, starting at 0.
    #
    # Mobile screens repeat labels freely — one Path4Life screen carries thirty
    # buttons named "play" — so a locator alone identifies a set, not an element.
    # Without this the driver silently acts on the first of that set and the
    # agent's actual choice is discarded.
    match_index: int = 0
    # Whether this element is on screen, as the snapshot reports it.
    #
    # An iOS app keeps every tab mounted, so a label the agent can see is often
    # matched by a second element with the same name on a tab nobody is looking
    # at. Carrying this lets the driver ask for the on-screen one and count its
    # position among the on-screen ones, which is the set the agent was reading.
    visible: bool = True
