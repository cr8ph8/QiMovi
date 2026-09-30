"""Historical private-fixture runner excluded from the public source release.

Use blender-stage.py and project-authored DCC stage kits for generic staging.
This entry point deliberately cannot manufacture a successful proof receipt.
"""
if __name__ == "__main__":
    raise SystemExit("NO_PRIVATE_PROOF_FIXTURE: Use a project-authored DCC stage kit.")
