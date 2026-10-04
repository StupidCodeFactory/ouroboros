import unittest

from months import months_between


class MonthsBetweenTest(unittest.TestCase):
    def test_same_year_is_inclusive(self):
        self.assertEqual(months_between(202401, 202403), 3)

    def test_across_december_is_inclusive(self):
        self.assertEqual(months_between(202411, 202502), 4)


if __name__ == "__main__":
    unittest.main()
