from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional

app = FastAPI(
    title="ApplyBro AI Matching Engine",
    description="Python FastAPI service for Resume Parsing, Eligibility Checks, and 0-100 Matching",
    version="1.0.0"
)

class JobMatchRequest(BaseModel):
    user_skills: List[str]
    user_experience_years: float
    job_required_skills: List[str]
    job_min_experience_years: float
    user_work_mode: str
    job_work_mode: str

class JobMatchResponse(BaseModel):
    match_score: int
    is_eligible: bool
    matching_skills: List[str]
    missing_skills: List[str]
    eligibility_reason: str

@app.post("/ai/match", response_model=JobMatchResponse)
def calculate_match(payload: JobMatchRequest):
    # Normalize skill sets
    user_set = set(s.lower() for s in payload.user_skills)
    req_set = set(s.lower() for s in payload.job_required_skills)
    
    matching = list(user_set.intersection(req_set))
    missing = list(req_set - user_set)
    
    # Eligibility checks
    is_eligible = True
    reason = "User meets hard eligibility criteria"
    
    if payload.user_experience_years < payload.job_min_experience_years:
        is_eligible = False
        reason = f"Experience below minimum requirement ({payload.user_experience_years}y vs {payload.job_min_experience_years}y)"
        
    # Calculate score (0-100)
    skill_ratio = len(matching) / len(req_set) if len(req_set) > 0 else 1.0
    score = int(skill_ratio * 100)
    
    return JobMatchResponse(
        match_score=score,
        is_eligible=is_eligible,
        matching_skills=matching,
        missing_skills=missing,
        eligibility_reason=reason
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

