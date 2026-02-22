#!/usr/bin/env python3

from datetime import datetime


def main() -> None:
    now = datetime.now().astimezone()
    print(now.strftime("%Y-%m-%d %H:%M:%S %Z (%z)"))


if __name__ == "__main__":
    main()
