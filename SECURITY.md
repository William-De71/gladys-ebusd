# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy))
and ebusd itself (see the [ebusd project](https://github.com/john30/ebusd)).

The optional ebusd user and secret are kept by Gladys as a secret setting,
never logged. The `/data` volume of the integration keeps the number of
writes of the day and the time of the last write of each message.

ebusd has no authentication on its TCP port unless it is started with an
access file (`--aclfile`): anyone on the local network can then read the bus
and, with `--enablehex` or a writable message, change the heating. Keep it on a
trusted network, never exposed to the Internet, or use an access file. The
integration itself writes nothing unless "Allow changes" is ticked, and then
only messages open to everyone, room and hot water targets within fixed
bounds, spaced and counted.
