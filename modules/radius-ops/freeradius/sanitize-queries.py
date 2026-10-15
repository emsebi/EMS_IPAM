#!/usr/bin/env python3
"""Fail closed unless the packaged FreeRADIUS v3 PostgreSQL post-auth SQL
matches one of the explicitly supported templates.

Debian stable FreeRADIUS v3 templates differ in whether the optional Class
column is present.  Never retain User-Password in radpostauth, and always
record the actual UDP packet source separately from NAS-IP-Address.
"""
from pathlib import Path


PASSWORD = "'%{%{User-Password}:-%{Chap-Password}}'"
OLD_COLUMNS = '(username, pass, reply, authdate)'
CLASS_COLUMNS = '(username, pass, reply, authdate ${..class.column_name})'
OLD_TIME = "'%S.%M')"
CLASS_TIME = "'%S.%M' " + chr(92) + "\n"  # escaped continuation, then newline


def rewrite(template: str) -> str:
    if template.count(PASSWORD) != 1:
        raise RuntimeError('Unsupported FreeRADIUS post-auth password template')

    has_class = CLASS_COLUMNS in template
    has_old = OLD_COLUMNS in template
    if has_class == has_old:
        raise RuntimeError('Unsupported FreeRADIUS post-auth column template')

    columns = CLASS_COLUMNS if has_class else OLD_COLUMNS
    if template.count(columns) != 1:
        raise RuntimeError('Ambiguous FreeRADIUS post-auth columns')

    if has_class:
        time_pattern = CLASS_TIME
        new_columns = '(username, pass, reply, authdate, nasipaddress, sourceipaddress ${..class.column_name})'
        time_replacement = ("'%S.%M', " + chr(92) + "\n" +
                            "\t\t\t'%{NAS-IP-Address}', " + chr(92) + "\n" +
                            "\t\t\t'%{Packet-Src-IP-Address}' " + chr(92) + "\n")
    else:
        time_pattern = OLD_TIME
        new_columns = '(username, pass, reply, authdate, nasipaddress, sourceipaddress)'
        time_replacement = "'%S.%M', '%{NAS-IP-Address}', '%{Packet-Src-IP-Address}')"

    if template.count(time_pattern) != 1:
        raise RuntimeError('Unsupported FreeRADIUS post-auth values template')

    before = {
        'source_xlat': template.count('%{Packet-Src-IP-Address}'),
        'source_column': template.count('sourceipaddress'),
        'nas_value': template.count("'%{NAS-IP-Address}'"),
        'new_columns': template.count(new_columns),
    }
    result = (template.replace(PASSWORD, "''")
                      .replace(columns, new_columns)
                      .replace(time_pattern, time_replacement))
    after = {
        'source_xlat': result.count('%{Packet-Src-IP-Address}'),
        'source_column': result.count('sourceipaddress'),
        'nas_value': result.count("'%{NAS-IP-Address}'"),
        'new_columns': result.count(new_columns),
    }
    expected_delta = {key: 1 for key in before}
    actual_delta = {key: after[key] - before[key] for key in before}
    if PASSWORD in result or actual_delta != expected_delta:
        raise RuntimeError('Unsafe FreeRADIUS post-auth query after rewrite')
    return result


if __name__ == '__main__':
    p = Path('/etc/freeradius/3.0/mods-config/sql/main/postgresql/queries.conf')
    p.write_text(rewrite(p.read_text()))
