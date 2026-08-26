# ruff: noqa: E501

from pathlib import Path

from pytest import fixture

from alumnium.accessibility import XCUITestAccessibilityTree


def tree(filename: str) -> XCUITestAccessibilityTree:
    with open(Path(__file__).parent.parent / "fixtures" / f"{filename}.xml", "r") as f:
        xml = f.read()
    return XCUITestAccessibilityTree(xml)


@fixture
def simple_tree() -> XCUITestAccessibilityTree:
    return tree("simple_xcuitest_accessibility_tree")


def test_element_by_id(simple_tree: XCUITestAccessibilityTree):
    element = simple_tree.element_by_id(74)
    assert element.id == 74
    assert element.name == "Continue"
    assert element.type == "XCUIElementTypeButton"


def test_scope_to_area_returns_original_if_not_found(simple_tree: XCUITestAccessibilityTree):
    # Try to scope to a non-existent element
    result = simple_tree.scope_to_area(99999)
    # Should return the original tree when element not found
    assert result.to_str() == simple_tree.to_str()


@fixture
def duplicated_tree() -> XCUITestAccessibilityTree:
    return tree("duplicated_xcuitest_accessibility_tree")


def test_match_index_is_zero_for_a_unique_element(simple_tree: XCUITestAccessibilityTree):
    assert simple_tree.element_by_id(74).match_index == 0


def test_match_index_counts_earlier_elements_with_the_same_attributes(
    duplicated_tree: XCUITestAccessibilityTree,
):
    # The screen repeats one banner label down the whole hierarchy, so a
    # predicate built from any of them matches every one. The index is what
    # tells them apart, and it follows document order.
    assert [duplicated_tree.element_by_id(raw_id).match_index for raw_id in (7, 8, 9, 10)] == [0, 1, 2, 3]


def test_contains_webview_is_false_for_a_native_screen(simple_tree: XCUITestAccessibilityTree):
    assert simple_tree.contains_webview() is False


def test_contains_webview_is_true_when_the_screen_embeds_one():
    xml = (
        '<AppiumAUT><XCUIElementTypeApplication type="XCUIElementTypeApplication" name="FooBar">'
        '<XCUIElementTypeWebView type="XCUIElementTypeWebView" name="content" />'
        "</XCUIElementTypeApplication></AppiumAUT>"
    )
    assert XCUITestAccessibilityTree(xml).contains_webview() is True
