<table align="center">
<tr>
<th align="left">
<img src="https://img.shields.io/badge/-%20-red?style=flat&logo=target&logoColor=red" height="12">
<img src="https://img.shields.io/badge/-%20-yellow?style=flat&logo=target&logoColor=yellow" height="12">
<img src="https://img.shields.io/badge/-%20-green?style=flat&logo=target&logoColor=green" height="12">
</th>
</tr>
<tr>
<td>

```text
shrimp@terminal - ---------------------------------------
| OS: ..................... Windows 10, Android 14, Linux
| Uptime: ................... 14 years, 11 months, 7 days```
> **Note:** The `` markers are invisible to people looking at your profile, but they let the script know exactly where to "cut and paste" the new time.

---

## 2. The script: `scripts/update_uptime.py`
Create this file in your `scripts` folder. This does the math and the file editing.

```python
import datetime
import re

def update_readme():
    # Your birthday: March 6, 2011
    birth_date = datetime.date(2011, 3, 6)
    today = datetime.date.today()

    years = today.year - birth_date.year
    months = today.month - birth_date.month
    days = today.day - birth_date.day

    # Basic date math correction
    if days < 0:
        months -= 1
        days += 30
    if months < 0:
        years -= 1
        months += 12

    uptime_str = f"{years} years, {months} months, {days} days"

    with open("README.md", "r", encoding="utf-8") as f:
        content = f.read()

    # This regex finds the markers and replaces only the text inside them
    pattern = r".*?"
    replacement = f"{uptime_str}"
    new_content = re.sub(pattern, replacement, content)

    with open("README.md", "w", encoding="utf-8") as f:
        f.write(new_content)

if __name__ == "__main__":
    update_readme()
| Host: .......................... Tesla STEM High School
| Kernel: .................... Game Dev, Student, Violist
| IDE: ........... IDEA 2024.1, VSCode 1.98.0, GitHub CLI
  
| Languages.Programming: ......................... Python
| Languages.Computer: ......................... HTML, CSS
| Languages.Real: ............ English, Mandarin, Spanish

| Hobbies.Software: .............. Godot, Web Design, CAD
| Hobbies.Hardware: .............. CAD, Adobe Illustrator

- Contact - ---------------------------------------------
| Email.Personal: ............. one.walmart.bag@gmail.com
| Discord: ............................... imjusta_shrimp
|
| _ > █
