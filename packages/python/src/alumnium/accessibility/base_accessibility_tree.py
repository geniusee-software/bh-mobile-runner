from abc import ABC, abstractmethod

from .accessibility_element import AccessibilityElement


class BaseAccessibilityTree(ABC):
    @abstractmethod
    def to_str(self) -> str:
        pass

    @abstractmethod
    def element_by_id(self, raw_id: int) -> AccessibilityElement:
        pass

    @abstractmethod
    def scope_to_area(self, raw_id: int) -> "BaseAccessibilityTree":
        pass

    def contains_webview(self) -> bool:
        """Whether the rendered UI embeds a web view.

        Appium drivers use this to decide whether enumerating webview contexts —
        a multi-second round trip on both iOS and Android — can be skipped. The
        default is True so a tree that cannot answer never causes a driver to
        miss a webview; platforms that can answer override it.
        """
        return True
