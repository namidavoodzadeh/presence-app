import math, re, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import cost_per_active as c


class CostPerActive(unittest.TestCase):
    def test_no_query_names_a_text_column_or_returns_a_person_id(self):
        for scope in c.SCOPES:
            for name, sql in c.queries(7, scope).items():
                for col in c.TEXT_COLUMNS:
                    self.assertIsNone(re.search(rf"\b{col}\b", sql), f"{name} names {col}")
                head = sql.split(" from ")[0] if name in ("kinds", "purposes") else sql
                # a person id is only ever grouped on inside a CTE, never selected out
                self.assertNotRegex(head, r"select person\b" if name in ("kinds", "purposes") else r"^select person\b")

    def test_people_query_selects_aggregates_only(self):
        sql = c.queries(7, "all")["people"]
        outer = sql[sql.index(") select ") + len(") select "):]
        self.assertNotIn("person,", outer.replace("person_", ""))
        self.assertNotIn("select *", sql)

    def test_labels_leave_the_database_only_as_closed_lists(self):
        # QA 15 Nov 14:08Z: kind, purpose and model are free strings; each is mapped to a closed list or 'other' in SQL
        for scope in c.SCOPES:
            q = c.queries(7, scope)
            for name, cols in (("kinds", {"kind": c.LEDGER_KINDS}), ("purposes", {"purpose": c.PURPOSES, "model": c.MODELS})):
                sql = q[name]
                select_list = sql[len("select "):sql.index(" from ")] if name == "kinds" else sql[len("select "):sql.index(" from engine_calls")]
                for col, values in cols.items():
                    expr = c._closed(col, values)
                    self.assertIn(f"{expr} as {col}", select_list, f"{name}.{col} is not a closed mapping")
                    self.assertTrue(all(f"'{v}'" in expr for v in values))
                    # the raw column is never a bare select item or a group key
                    bare = select_list.replace(expr, "")
                    self.assertIsNone(re.search(rf"(?<![\w.]){col}(?![\w(])", bare.replace(f"as {col}", "")), f"{name} selects raw {col}")
                self.assertRegex(sql, r"group by 1(, 2)?( order by| $)|group by 1(, 2)? order by")
                self.assertNotRegex(sql, r"group by (kind|purpose|model)\b")

    def test_closed_lists_cover_the_code(self):
        self.assertEqual(c.MODELS, tuple(c.RATES_CENTS_PER_MILLION))
        self.assertIn("other", c._closed("kind", c.LEDGER_KINDS))
        with self.assertRaises(ValueError): c._closed("kind", ("a'; drop table x; --",))

    def test_response_rows_outside_the_closed_list_are_refused(self):
        ok = [{"kind": "talk"}, {"kind": "other"}]
        self.assertEqual(c.check_closed(ok, "kind", c.LEDGER_KINDS), ok)
        with self.assertRaises(SystemExit): c.check_closed([{"kind": "free text a person typed"}], "kind", c.LEDGER_KINDS)
        with self.assertRaises(SystemExit): c.check_closed([{"model": "gpt-x"}], "model", c.MODELS)

    def test_queries_are_read_only(self):
        for sql in c.queries(30, "real").values():
            self.assertIsNone(re.search(r"\b(insert|update|delete|drop|alter|truncate|grant)\b", sql, re.I))

    def test_eval_and_preview_rows_never_count_as_people(self):
        sql = c.queries(7, "all")["people"]
        self.assertIn("kind not like 'eval:%'", sql)
        self.assertIn("not owner_preview", sql)

    def test_real_scope_drops_example_preview_and_persona_accounts(self):
        sql = c.queries(7, "real")["people"]
        self.assertIn("not is_example and not is_preview and persona is null", sql)
        self.assertNotIn("persona is null", c.queries(7, "all")["people"])

    def test_bad_arguments_refused(self):
        for d in (0, 91, "7; drop table x", 3.5, True):
            with self.assertRaises(ValueError): c.queries(d, "all")
        for s in ("", "everyone", "all'--"):
            with self.assertRaises(ValueError): c.queries(7, s)

    def test_projection_arithmetic(self):
        # 10 people spent 700 cents in 7 days over 35 person-days; ledger lifetime 15,000 cents
        p = c.project({"active_people": 10, "cents": 700, "person_days": 35, "active_days_mean": 3.5},
                      {"total_cents": 15000}, 7, users=(100, 1000))
        self.assertAlmostEqual(p["cents_per_active_month"], 300.0)  # 70 a week -> 300 a 30-day month
        self.assertAlmostEqual(p["cents_per_active_day"], 20.0)
        self.assertEqual(p["daily_active_people_at_shared_cap"], 150)  # 3,000 / 20
        self.assertEqual(p["total_cap_cents_left"], 5000)
        a100, a1000 = p["at"]
        self.assertEqual(a100["monthly_cents"], 30000.0)
        self.assertEqual(a100["days_to_total_cap"], 5.0)  # 5,000 left / 1,000 a day
        self.assertFalse(a100["shared_day_cap_hit"])
        self.assertEqual(a1000["days_to_total_cap"], 0.5)
        self.assertTrue(a1000["shared_day_cap_hit"])

    def test_projection_with_nobody_active_is_unavailable_not_zero(self):
        p = c.project({"active_people": 0, "cents": 0, "person_days": 0}, {"total_cents": 1873}, 7)
        self.assertIsNone(p["cents_per_active_month"])
        self.assertIsNone(p["daily_active_people_at_shared_cap"])
        self.assertTrue(all(a["monthly_cents"] is None for a in p["at"]))

    def test_projection_handles_nulls_from_sql(self):
        p = c.project({"active_people": None, "cents": None, "person_days": None}, {"total_cents": None}, 7)
        self.assertIsNone(p["cents_per_active_month"])
        self.assertEqual(p["total_cap_cents_left"], c.TOTAL_CAP_CENTS)

    def test_rate_table_matches_client_ts(self):
        ts = (Path(__file__).resolve().parents[1] / "engine/model/client.ts").read_text()
        block = ts[ts.index("RATES_CENTS_PER_MILLION"):ts.index("};", ts.index("RATES_CENTS_PER_MILLION"))]
        found = {m: (int(i), int(o)) for m, i, o in re.findall(r'"([\w.-]+)": \[(\d+), (\d+)\]', block)}
        self.assertEqual(found, c.RATES_CENTS_PER_MILLION)
        w = re.search(r"WORST_RATE: \[number, number\] = \[(\d+), (\d+)\]", ts)
        self.assertEqual((int(w.group(1)), int(w.group(2))), c.WORST_RATE)
        self.assertIn("cacheCreationInputTokens * inputRate * 1.25", ts)
        self.assertIn("? 0.05 : 0.1", ts)

    def test_exact_cents_is_usage_cents_without_the_ceil(self):
        # one Haiku safety reading: 4 in, 46 out, 1,195 cache read, 34 cache write
        e = c.exact_cents("claude-haiku-5-5", 4, 46, 34, 1195)
        self.assertAlmostEqual(e, (4 * 100 + 34 * 125 + 1195 * 10 + 46 * 500) / 1e6)
        self.assertEqual(math.ceil(e), 1)  # the ledger counts this call as a whole cent
        # Sonnet 5.5 cache reads at 5% of input
        self.assertAlmostEqual(c.exact_cents("claude-sonnet-5-5", 0, 0, 0, 1_000_000), 15.0)
        self.assertAlmostEqual(c.exact_cents("unknown-model", 1_000_000, 0, 0, 0), 300.0)

    def test_purpose_table(self):
        rows = c.purpose_table([{"purpose": "safety", "model": "claude-haiku-5-5", "calls": 2, "cents": 2,
                                 "input_sum": 0, "output_sum": 200, "errors": 1, "error_cents": 1, "cache_read_sum": 0, "cache_write_sum": 0,
                                 "ms_p50": 1000, "ms_p95": 1400}])
        self.assertEqual(rows[0]["ledger_cents"], 2.0)
        self.assertEqual(rows[0]["exact_cents"], 0.1)
        self.assertEqual(rows[0]["exact_cents_per_call"], 0.05)
        self.assertEqual((rows[0]["errors"], rows[0]["error_ledger_cents"]), (1, 1.0))
        self.assertNotIn("person", rows[0])


if __name__ == "__main__":
    unittest.main()
