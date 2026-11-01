#!/usr/bin/env python3
"""Disposable-lab RADIUS PAP probe with an explicit UDP source address.

Unlike radtest against 127.0.0.1, this can exercise two registered NAS IPs
from the same container and detect a spoofed NAS-IP-Address attribute.
No credentials are logged, persisted, or sent to any non-loopback address.
"""
import argparse
import hashlib
import hmac
import ipaddress
import os
import socket
import struct


def attr(code, data):
    if not isinstance(data, bytes) or len(data) > 253:
        raise ValueError('Invalid RADIUS attribute length')
    return bytes((code, len(data) + 2)) + data


def hide_password(password, secret, request_authenticator):
    raw = password.encode('utf-8')
    if not 1 <= len(raw) <= 128:
        raise ValueError('Invalid password length')
    padded = raw + b'\x00' * ((-len(raw)) % 16)
    result = bytearray()
    previous = request_authenticator
    for offset in range(0, len(padded), 16):
        mask = hashlib.md5(secret + previous).digest()
        encrypted = bytes(a ^ b for a, b in zip(padded[offset:offset + 16], mask))
        result.extend(encrypted)
        previous = encrypted
    return bytes(result)


def request_packet(username, password, secret, claimed_ip, identifier=7, authenticator=None,
                   nas_identifier='', calling_station_id='', framed_ip='', method='pap'):
    authenticator = os.urandom(16) if authenticator is None else authenticator
    if len(authenticator) != 16 or not 0 <= identifier <= 255:
        raise ValueError('Invalid RADIUS identifier or authenticator')
    username_bytes = username.encode('utf-8')
    if method == 'pap':
        proof = attr(2, hide_password(password, secret, authenticator))
    elif method == 'chap':
        chap_id = bytes((identifier,))
        proof = attr(3, chap_id + hashlib.md5(chap_id + password.encode() + authenticator).digest())
    elif method == 'mschapv2':
        # Public RFC 2759 section 9.2 fixture. This mode cannot handle real
        # user credentials; it exists only in the disposable loopback lab.
        if username != 'User' or password != 'clientPass':
            raise ValueError('MS-CHAPv2 probe requires the public RFC fixture')
        challenge = bytes.fromhex('5b5d7c7d7b3f2f3e3c2c602132262628')
        response = bytes.fromhex('010021402324255e262a28295f2b3a337c7e0000000000000000'
                                 '82309ecd8d708b5ea08faa3981cd83544233114a3d85d6df')
        proof = (attr(26, struct.pack('!I', 311) + attr(11, challenge)) +
                 attr(26, struct.pack('!I', 311) + attr(25, response)))
    else:
        raise ValueError('Unsupported authentication method')
    attributes = attr(1, username_bytes) + proof + attr(4, socket.inet_aton(claimed_ip))
    if nas_identifier:
        attributes += attr(32, nas_identifier.encode('utf-8'))
    if calling_station_id:
        attributes += attr(31, calling_station_id.encode('utf-8'))
    if framed_ip:
        attributes += attr(8, socket.inet_aton(framed_ip))
    # Include Message-Authenticator to exercise modern hardened RADIUS servers.
    unsigned = attributes + attr(80, b'\x00' * 16)
    length = 20 + len(unsigned)
    header = struct.pack('!BBH', 1, identifier, length)
    digest = hmac.new(secret, header + authenticator + unsigned, hashlib.md5).digest()
    packet = header + authenticator + attributes + attr(80, digest)
    return packet, authenticator


def verify_response(packet, request_authenticator, secret, identifier, require_message_authenticator=True):
    """Verify the RFC 2865 authenticator and RFC 3579 Message-Authenticator.

    Require Message-Authenticator like RouterOS yes-for-request-resp, not just
    an outer response authenticator. Refuse missing, invalid and duplicate
    signatures. The optional legacy mode exists only for offline diagnostics.
    """
    if len(packet) < 20 or len(request_authenticator) != 16:
        raise ValueError('Truncated RADIUS response or request authenticator')
    code, actual_id, length = struct.unpack('!BBH', packet[:4])
    if length != len(packet) or actual_id != identifier or code not in (2, 3, 11):
        raise ValueError('Invalid RADIUS response framing')
    offset = 20
    message_auth = None
    while offset < length:
        if offset + 2 > length:
            raise ValueError('Truncated RADIUS attribute')
        kind, size = packet[offset], packet[offset + 1]
        if size < 2 or offset + size > length:
            raise ValueError('Invalid RADIUS attribute length')
        if kind == 80:
            if size != 18 or message_auth is not None:
                raise ValueError('Invalid or duplicate Message-Authenticator')
            message_auth = (offset, packet[offset + 2:offset + 18])
        offset += size
    expected = hashlib.md5(packet[:4] + request_authenticator + packet[20:] + secret).digest()
    if not hmac.compare_digest(expected, packet[4:20]):
        raise ValueError('Invalid RADIUS response authenticator')
    if require_message_authenticator and message_auth is None:
        raise ValueError('Missing required RADIUS Message-Authenticator')
    if message_auth is not None:
        pos, actual_hmac = message_auth
        unsigned = bytearray(packet)
        unsigned[4:20] = request_authenticator
        unsigned[pos + 2:pos + 18] = b'\x00' * 16
        expected_hmac = hmac.new(secret, unsigned, hashlib.md5).digest()
        if not hmac.compare_digest(expected_hmac, actual_hmac):
            raise ValueError('Invalid RADIUS Message-Authenticator')
    return {2: 'Access-Accept', 3: 'Access-Reject', 11: 'Access-Challenge'}[code]


def probe(source, claimed, username, password, secret_text, timeout=4, destination_port=1812,
          nas_identifier='', calling_station_id='', framed_ip='', method='pap',
          expected_mikrotik_group='', expected_cisco_privilege=None):
    try:
        source_ip = ipaddress.ip_address(source)
        claimed_ip = ipaddress.ip_address(claimed)
    except ValueError as exc:
        raise ValueError('Only lab loopback IPv4 addresses are permitted') from exc
    if source_ip.version != 4 or not source_ip.is_loopback:
        raise ValueError('Only lab loopback NAS source IPs are permitted')
    if claimed_ip.version != 4 or not claimed_ip.is_loopback:
        raise ValueError('Only lab loopback NAS claims are permitted')
    if not isinstance(destination_port, int) or not 1 <= destination_port <= 65535:
        raise ValueError('Invalid loopback RADIUS port')
    secret = secret_text.encode('utf-8')
    identifier = os.urandom(1)[0]
    if framed_ip:
        try:
            framed = ipaddress.ip_address(framed_ip)
        except ValueError as exc:
            raise ValueError('Only lab loopback framed IPs are permitted') from exc
        if framed.version != 4 or not framed.is_loopback:
            raise ValueError('Only lab loopback framed IPs are permitted')
    packet, authenticator = request_packet(
        username, password, secret, claimed, identifier,
        nas_identifier=nas_identifier, calling_station_id=calling_station_id,
        framed_ip=framed_ip, method=method)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.bind((source, 0))
        sock.settimeout(timeout)
        sock.sendto(packet, ('127.0.0.1', destination_port))
        reply, peer = sock.recvfrom(4096)
    if peer[0] != '127.0.0.1' or peer[1] != destination_port:
        raise ValueError('Unexpected RADIUS reply source')
    result = verify_response(reply, authenticator, secret, identifier)
    if expected_mikrotik_group or expected_cisco_privilege is not None:
        if result != 'Access-Accept':
            raise ValueError('Expected Access-Accept with permission attributes')
        wanted = {}
        if expected_mikrotik_group:
            wanted[(14988, 3)] = expected_mikrotik_group.encode()
        if expected_cisco_privilege is not None:
            wanted[(9, 1)] = ('shell:priv-lvl=' + str(expected_cisco_privilege)).encode()
        found = {key: [] for key in wanted}
        offset = 20
        while offset < len(reply):
            kind, length = reply[offset], reply[offset + 1]
            value = reply[offset + 2:offset + length]
            if kind == 26 and len(value) >= 6:
                vendor = struct.unpack('!I', value[:4])[0]
                sub = 4
                while sub < len(value):
                    if sub + 2 > len(value) or value[sub + 1] < 2 or sub + value[sub + 1] > len(value):
                        raise ValueError('Malformed vendor attribute')
                    key = (vendor, value[sub])
                    if key in found:
                        found[key].append(value[sub + 2:sub + value[sub + 1]])
                    sub += value[sub + 1]
            offset += length
        if any(found[key] != [expected] for key, expected in wanted.items()):
            raise ValueError('Incorrect or duplicate permission attributes')
    return result


def main():
    parser = argparse.ArgumentParser(description='Loopback-only NAS source RADIUS probe')
    for name in ('source', 'claimed', 'username', 'password', 'secret'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--nas-identifier', default='')
    parser.add_argument('--calling-station-id', default='')
    parser.add_argument('--framed-ip', default='')
    parser.add_argument('--method', choices=('pap','chap','mschapv2'), default='pap')
    parser.add_argument('--expect-mikrotik-group', default='')
    parser.add_argument('--expect-cisco-privilege', type=int)
    args = parser.parse_args()
    try:
        print(probe(args.source, args.claimed, args.username, args.password, args.secret,
                    nas_identifier=args.nas_identifier,
                    calling_station_id=args.calling_station_id,
                    framed_ip=args.framed_ip, method=args.method,
                    expected_mikrotik_group=args.expect_mikrotik_group,
                    expected_cisco_privilege=args.expect_cisco_privilege))
    except (ValueError, OSError, socket.timeout):
        print('Probe-Failed')
        raise SystemExit(1)


if __name__ == '__main__':
    main()
