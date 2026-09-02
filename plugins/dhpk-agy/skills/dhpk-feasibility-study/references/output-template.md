# Feasibility Study Output Template

```markdown
# [Requirement Name] Feasibility Study Report

## 1. Problem Essence

### 1.1 Surface Requirement

> What the user is asking for

### 1.2 Underlying Problem

> What is the core problem to actually solve?
> (5 Why probing result)

### 1.3 Success Criteria

> How do we know the problem is solved?
> (Quantifiable acceptance conditions)

## 2. Constraints

| Type | Constraint | Source | Flexibility |
| ---- | ---------- | ------ | ----------- |
| ...  | ...        | ...    | ...         |

## 3. Existing Capability Inventory

### 3.1 Related Modules

- `src/xxx.ts` - Reusable XX logic

### 3.2 Design Patterns

- Implementation approach of similar features

### 3.3 Tech Debt

- Known issues to work around

## 4. Possible Solutions

### Option A: [Description]

**Core idea**: One sentence

**Implementation path**:

1. ...
2. ...

**Feasibility assessment**:
| Dimension | Rating | Notes |
|-----------|:------:|-------|
| Technical Feasibility | 🟢/🟡/🔴 | ... |
| Effort | ... | ... |
| Risk | ... | ... |
| Extensibility | ... | ... |

**Cost**:

- ...

---

### Option B: [Description]

(Same structure)

---

### Option C: [Description]

(Same structure, quantity is flexible)

## 5. Independent Comparison Record

### 5.1 Discussion Process Summary

| Round | Discussion Topic             | Independent Reviewer Viewpoint |
| ----- | ---------------------------- | ------------------------------- |
| 1     | Initial solution enumeration | ...                 |
| 2     | Follow-up on details         | ...                 |
| 3     | Verify after modification    | ...                 |

### 5.2 Solution Directions Suggested by the Reviewer

- ...

### 5.3 Risks/Issues Identified by the Reviewer

- ...

### 5.4 Differences from the Primary Analysis

| Viewpoint               | Primary model | Independent reviewer | Adopted |
| ----------------------- | ------------- | -------------------- | ------- |
| Core problem understanding | ... | ...   | ...     |
| Recommended direction   | ...    | ...   | ...     |
| Risk assessment         | ...    | ...   | ...     |

### 5.5 Integrated Conclusion

> Combined recommendation from available perspectives, with trade-off rationale.
> If no reviewer ran, state: **Degraded — only the primary model's comparison
> is present; no independent review ran.**

## 6. Solution Comparison

| Dimension             | Option A | Option B | ... |
| --------------------- | :------: | :------: | :-: |
| Technical Feasibility |   🟢    |   🟡    | ... |
| Effort                |   5d     |  10d     | ... |
| Risk                  |   🟢    |   🟡    | ... |
| Extensibility         |   🟡    |   🟢    | ... |
| Maintenance Cost      |   🟢    |   🟢    | ... |

## 7. Recommendation

**Recommended**: Option X
**Rationale**:

- Meets constraints: [list]
- Balance point: [trade-off explanation]
- Independent reviewer viewpoint: [agreement/additions, if requested]

**Backup**: Option Y
**Applicable scenario**: If [condition], choose Y

## 8. Open Questions

- [ ] Question 1
- [ ] Question 2

## 9. Next Steps

- `/dhpk:dhpk-tech-spec` - Detailed design for the selected solution
- `/deep-analyze` - Deepen the roadmap for the selected solution
```
