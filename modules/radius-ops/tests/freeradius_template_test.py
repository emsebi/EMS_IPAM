"""Offline tests against the FreeRADIUS 3.0 PostgreSQL query shape."""
import importlib.util
from pathlib import Path
import unittest

module_file = Path(__file__).parents[1] / 'freeradius/sanitize-queries.py'
spec = importlib.util.spec_from_file_location('sanitize_queries', module_file)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class QueryRewriteTest(unittest.TestCase):
    def test_rewrites_password_and_records_source(self):
        original = '''post-auth {
 query = "\\
  INSERT INTO ${..postauth_table} \\
   (username, pass, reply, authdate ${..class.column_name}) \\
  VALUES(\\
   '%{User-Name}', \\
   '%{%{User-Password}:-%{Chap-Password}}', \\
   '%{reply:Packet-Type}', \\
   '%S.%M' \\
   ${..class.reply_xlat})"
}
'''
        rewritten = mod.rewrite(original)
        self.assertIn("''", rewritten)
        self.assertNotIn("'%{%{User-Password}:-%{Chap-Password}}'", rewritten)
        self.assertIn('sourceipaddress', rewritten)
        self.assertIn("'%{Packet-Src-IP-Address}' \\\n", rewritten)
        self.assertIn('nasipaddress', rewritten)

    def test_legacy_bookworm_style_without_class_column(self):
        original = ("post-auth {\n"
                    " query = \"\\\n"
                    "  INSERT INTO ${..postauth_table} \\\n"
                    "   (username, pass, reply, authdate) \\\n"
                    "  VALUES(\\\n"
                    "   '%{User-Name}', \\\n"
                    "   '%{%{User-Password}:-%{Chap-Password}}', \\\n"
                    "   '%{reply:Packet-Type}', \\\n"
                    "   '%S.%M')\"\n"
                    "}\n")
        updated = mod.rewrite(original)
        self.assertIn('(username, pass, reply, authdate, nasipaddress, sourceipaddress)', updated)
        self.assertIn("'%S.%M', '%{NAS-IP-Address}', '%{Packet-Src-IP-Address}')", updated)
        self.assertNotIn("'%{%{User-Password}:-%{Chap-Password}}'", updated)


    def test_full_queries_file_may_already_reference_nas_and_packet_source(self):
        original = ("accounting {\n"
                    " query = \"UPDATE radacct SET nasipaddress = '%{NAS-IP-Address}', "
                    "callingstationid = '%{Packet-Src-IP-Address}' WHERE id = 1\"\n"
                    "}\n"
                    "post-auth {\n"
                    " query = \"\\\n"
                    "  INSERT INTO ${..postauth_table} \\\n"
                    "   (username, pass, reply, authdate) \\\n"
                    "  VALUES(\\\n"
                    "   '%{User-Name}', \\\n"
                    "   '%{%{User-Password}:-%{Chap-Password}}', \\\n"
                    "   '%{reply:Packet-Type}', \\\n"
                    "   '%S.%M')\"\n"
                    "}\n")
        updated = mod.rewrite(original)
        self.assertEqual(updated.count("'%{NAS-IP-Address}'"), 2)
        self.assertEqual(updated.count('%{Packet-Src-IP-Address}'), 2)
        self.assertIn('(username, pass, reply, authdate, nasipaddress, sourceipaddress)', updated)
        self.assertNotIn("'%{%{User-Password}:-%{Chap-Password}}'", updated)

    def test_refuses_duplicate_password_or_unknown_columns(self):
        original = "(username, pass, reply, authdate)\n'%{%{User-Password}:-%{Chap-Password}}'\n'%S.%M')"
        with self.assertRaises(RuntimeError):
            mod.rewrite(original.replace('pass, reply', 'pass, unknown, reply'))
        with self.assertRaises(RuntimeError):
            mod.rewrite(original + "\n'%{%{User-Password}:-%{Chap-Password}}'")

    def test_fails_closed_on_unknown_templates(self):
        with self.assertRaises(RuntimeError):
            mod.rewrite('unexpected query')


if __name__ == '__main__':
    unittest.main()
