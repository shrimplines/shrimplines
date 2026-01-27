```python
import re
from datetime import datetime

BORN = datetime(2011, 3, 6, 16, 52)

def update_readme():
    now = datetime.now()
    diff = now - BORN
    
    # Logic for years/months/days
    years = diff.days // 365
    months = (diff.days % 365) // 30
    days = (diff.days % 365) % 30
    
    # Create the lines that will go into the README
    uptime_line = f"| Uptime: ................... {years} years, {months} months, {days} days"
    login_line = f"| Last Login: ............... {now.strftime('%b %d, %H:%M')} PST on ttys000"
    
    new_data = f"\n{uptime_line}\n{login_line}\n"

    with open("README.md", "r", encoding="utf-8") as f:
        content = f.read()

    # Find the markers and swap the old text with the new time
    pattern = r".*?"
    updated_content = re.sub(pattern, new_data, content, flags=re.DOTALL)

    with open("README.md", "w", encoding="utf-8") as f:
        f.write(updated_content)

if __name__ == "__main__":
    update_readme()
