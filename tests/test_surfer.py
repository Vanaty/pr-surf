import unittest

from pr_surf.surfer import _popup_is_connected


class FakeLocator:
    def __init__(self, count: int):
        self._count = count

    def count(self) -> int:
        return self._count


class FakePage:
    def __init__(self, counts):
        self._counts = counts

    def locator(self, selector: str):
        return FakeLocator(self._counts.get(selector, 0))


class PopupConnectedStateTests(unittest.TestCase):
    def test_detects_connected_popup_when_start_button_exists(self):
        page = FakePage({"button[data-a='start']": 1})
        self.assertTrue(_popup_is_connected(page))

    def test_detects_connected_popup_when_money_widget_exists(self):
        page = FakePage({".money": 1})
        self.assertTrue(_popup_is_connected(page))

    def test_returns_false_when_popup_is_not_connected(self):
        page = FakePage({"button[data-a='pair']": 1})
        self.assertFalse(_popup_is_connected(page))


if __name__ == "__main__":
    unittest.main()
