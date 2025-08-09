import os
import json
import uuid
from datetime import datetime, timedelta
from typing import Dict, Any, List

import pandas as pd
from faker import Faker


DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
USERS_PATH = os.path.join(DATA_DIR, "users.json")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
PURCHASES_PATH = os.path.join(DATA_DIR, "purchases.json")


def ensure_data_dir() -> None:
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR, exist_ok=True)


def generate_fake_data(num_users: int = 100, num_events: int = 1500) -> None:
    """Create demo JSON data files if they don't already exist: users, events, purchases."""
    ensure_data_dir()
    fake = Faker()
    Faker.seed(42)


    if not os.path.exists(USERS_PATH):
        users: List[Dict[str, Any]] = []
        for _ in range(num_users):
            user_id = str(uuid.uuid4())
            users.append({
                "id": user_id,
                "email": fake.unique.email(),
                "name": fake.name(),
                "age": fake.random_int(min=18, max=80),
                "location": f"{fake.city()}, {fake.country()}",
                "signup_date": (datetime.utcnow() - timedelta(days=fake.random_int(min=0, max=365))).isoformat() + "Z",
            })
        with open(USERS_PATH, "w") as f:
            json.dump(users, f, indent=2)


    if not os.path.exists(EVENTS_PATH):
        event_types = ["page_view", "product_click", "add_to_cart", "checkout_start", "purchase", "support_click"]
        pages = ["home", "product", "reviews", "cart", "checkout", "support", "blog", "about"]
        with open(USERS_PATH) as f:
            users = json.load(f)
        user_ids = [u["id"] for u in users]

        events: List[Dict[str, Any]] = []
        now = datetime.utcnow()
        for _ in range(num_events):
            user_id = fake.random_element(elements=user_ids)
            events.append({
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "event_type": fake.random_element(elements=event_types),
                "page": fake.random_element(elements=pages),
                "session_duration_sec": max(0, int(fake.random_int(min=5, max=120) + fake.random_int(min=0, max=20) * 1.5)),
                "clicks": fake.random_int(min=0, max=20),
                "timestamp": (now - timedelta(days=fake.random_int(min=0, max=60), minutes=fake.random_int(min=0, max=1440))).isoformat() + "Z",
            })
        with open(EVENTS_PATH, "w") as f:
            json.dump(events, f, indent=2)


    if not os.path.exists(PURCHASES_PATH):
        currencies = ["USD", "EUR", "GBP", "CAD"]
        payment_methods = ["card", "paypal", "apple_pay", "google_pay"]
        products = [
            "Pod Cover", "Cooling Mattress", "Smart Pillow", "Bed Frame",
            "Sheet Set", "Duvet", "Protector", "Travel Case",
        ]
        with open(USERS_PATH) as f:
            users = json.load(f)
        user_ids = [u["id"] for u in users]

        purchases: List[Dict[str, Any]] = []
        now_p = datetime.utcnow()
        num_purchases = max(150, int(num_events * 0.25))
        for _ in range(num_purchases):
            uid = fake.random_element(elements=user_ids)
            items_count = fake.random_int(min=1, max=3)
            unit_price = fake.random_int(min=50, max=400)
            total_amount = float(unit_price * items_count)
            purchases.append({
                "id": str(uuid.uuid4()),
                "user_id": uid,
                "items_count": items_count,
                "total_amount": total_amount,
                "currency": fake.random_element(elements=currencies),
                "product": fake.random_element(elements=products),
                "payment_method": fake.random_element(elements=payment_methods),
                "purchased_at": (now_p - timedelta(days=fake.random_int(min=0, max=60), minutes=fake.random_int(min=0, max=1440))).isoformat() + "Z",
            })
        with open(PURCHASES_PATH, "w") as f:
            json.dump(purchases, f, indent=2)


def load_dataframes() -> Dict[str, pd.DataFrame]:
    with open(USERS_PATH) as f:
        users = json.load(f)
    with open(EVENTS_PATH) as f:
        events = json.load(f)
    with open(PURCHASES_PATH) as f:
        purchases = json.load(f)    
    return {
        "users": pd.DataFrame(users),
        "events": pd.DataFrame(events),
        "purchases": pd.DataFrame(purchases),
    }



