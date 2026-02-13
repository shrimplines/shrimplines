```python
import datetime
import re

def update_readme():
    # Born March 6, 2011
    birth_date = datetime.date(2011, 3, 6)
    today = datetime.date.today()

    years = today.year - birth_date.year
    months = today.month - birth_date.month
    days = today.day - birth_date.day

    if days < 0:
        months -= 1
        days += 30
    if months < 0:
        years -= 1
        months += 12

    uptime_str = f"{years} years, {months} months, {days} days"

    with open("README.md", "r", encoding="utf-8") as f:
        content = f.read()

    # Pattern looks strictly for the markers on the same line
    pattern = r".*?"
    replacement = f"{uptime_str}"
    
    new_content = re.sub(pattern, replacement, content)

    with open("README.md", "w", encoding="utf-8") as f:
        f.write(new_content)

if __name__ == "__main__":
    update_readme()
