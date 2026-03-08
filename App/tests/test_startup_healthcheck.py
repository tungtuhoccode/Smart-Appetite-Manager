import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src import startup_healthcheck


class StartupHealthCheckTests(unittest.TestCase):
    def test_is_truthy_parser(self) -> None:
        self.assertTrue(startup_healthcheck._is_truthy("true"))
        self.assertTrue(startup_healthcheck._is_truthy("1"))
        self.assertFalse(startup_healthcheck._is_truthy("false"))
        self.assertFalse(startup_healthcheck._is_truthy(None, default=False))
        self.assertTrue(startup_healthcheck._is_truthy(None, default=True))

    def test_health_check_can_run_with_network_disabled(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "inventory.db"
            conn = sqlite3.connect(str(db_path))
            conn.execute("CREATE TABLE IF NOT EXISTS inventory (id INTEGER PRIMARY KEY)")
            conn.commit()
            conn.close()

            with patch.dict(
                os.environ,
                {
                    "LLM_SERVICE_API_KEY": "test-llm-key",
                    "SPOONACULAR_API_KEY": "test-spoon-key",
                    "SERPAPI_KEY": "test-serp-key",
                    "INVENTORY_MANAGER_DB_NAME": str(db_path),
                    "STARTUP_HEALTHCHECK_ENABLED": "true",
                    "STARTUP_HEALTHCHECK_NETWORK": "false",
                },
                clear=False,
            ):
                summary = startup_healthcheck.run_startup_health_checks()

        self.assertIsInstance(summary, dict)
        self.assertTrue(summary.get("enabled"))
        self.assertIn(summary.get("status"), {"pass", "warn", "fail"})
        self.assertIn("counts", summary)
        self.assertIn("results", summary)
        self.assertGreater(len(summary["results"]), 0)
        names = {result["name"] for result in summary["results"]}
        self.assertIn("Inventory Database", names)
        self.assertIn("Spoonacular API", names)
        self.assertIn("SerpApi", names)

    def test_health_check_disabled_flag(self) -> None:
        with patch.dict(
            os.environ,
            {"STARTUP_HEALTHCHECK_ENABLED": "false"},
            clear=False,
        ):
            summary = startup_healthcheck.run_startup_health_checks()

        self.assertFalse(summary["enabled"])
        self.assertEqual(summary["status"], "warn")
        self.assertEqual(summary["counts"]["warn"], 1)


if __name__ == "__main__":
    unittest.main()
