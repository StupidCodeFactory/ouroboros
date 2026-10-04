import requests


def trigger_backfill(base_url, symbol):
    resp = requests.post(f"{base_url}/v1/gaps/backfill", data={"symbol": symbol})
    return resp.json()["ok"]
