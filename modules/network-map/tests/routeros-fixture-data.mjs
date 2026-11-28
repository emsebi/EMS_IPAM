// Synthetic RouterOS output. The monitor labels follow MikroTik's official Bonding documentation:
// https://help.mikrotik.com/docs/spaces/ROS/pages/8323193/Bonding
export function routerosOutputs(version='7.16.2') {
 return {
  '/system resource print':`uptime: 1d2h\nversion: ${version} (stable)\nboard-name: CRS326-24G-2S+`,
  '/system identity print':'name: SyntheticRouterOS',
  '/interface print detail without-paging':`Flags: X - disabled, R - running, S - slave
 0 RS name="ether1" type="ether" mac-address=02:00:00:00:01:01
 1 RS name="ether2" type="ether" mac-address=02:00:00:00:01:02
 2 R name="ether3" type="ether" mac-address=02:00:00:00:01:03
 3 R name="ether4" type="ether" mac-address=02:00:00:00:01:04
 4 R name="bond-lacp" type="bond" mac-address=02:00:00:00:02:01
 5 R name="bond backup" type="bonding" mac-address=02:00:00:00:02:02`,
  '/interface bridge port print detail without-paging':'0 interface=bond-lacp bridge=bridge1 pvid=1 frame-types=admit-only-vlan-tagged',
  '/ip neighbor print detail without-paging':'0 interface=ether2 address=192.0.2.23 identity=SyntheticPeer interface-name=Gi0/3 discovered-by=lldp',
  '/interface bridge host print detail without-paging':'0 D mac-address=02:00:00:00:00:73 on-interface=bond-lacp vid=73',
  '/snmp print':'enabled: no', '/user aaa print':'use-radius: no',
  '/interface ethernet poe print detail without-paging':'Flags: X - disabled',
  '/export':'/interface bridge\nadd name=bridge1',
  '/export hide-sensitive':'/interface bridge\nadd name=bridge1',
  '/interface bonding print detail without-paging':`Flags: X - disabled, R - running
 0 R name="bond-lacp" slaves=ether1,ether2 mode=802.3ad link-monitoring=mii
 1 R name="bond backup" slaves=ether3,ether4 mode=active-backup link-monitoring=mii`,
  '/interface bonding monitor [find where name="bond-lacp"] once':'mode: 802.3ad\nactive-ports: ether1\ninactive-ports: ether2\nlacp-system-id: 02:00:00:00:02:01',
  '/interface bonding monitor [find where name="bond backup"] once':'mode: active-backup\nactive-ports: ether3\ninactive-ports: ether4',
 };
}
