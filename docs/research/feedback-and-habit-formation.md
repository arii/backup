
# Feedback and habit formation: what the evidence says, and what BackUp does

BackUp is a wellness tool and has not been clinically validated. This note
records the research behind its feedback design, so each choice can be traced to a
source or labelled as a judgement call. It is not medical advice. See
`.kiro/specs/safety-and-disclaimers/` for the safety stance.

## How the sources were checked

Every source below was looked up in a primary index on the date of writing
(Crossref for bibliographic metadata, PubMed or Europe PMC for abstracts, publisher
or Google pages for documentation). Each entry carries a status:

- **Verified**: metadata and the abstract (or page text) were read and support the
  one-line claim.
- **Metadata only**: the paper exists as cited (author, year, title, journal), but
  the publisher blocks the abstract. The claim is the paper's well-known thesis and
  its title says as much. Treat the detail as unverified.

Nothing is cited from memory alone. Sources that could not be opened at all were
dropped (Patterson's auditory warning guidelines, Chiviacowsky and Wulf 2002, the
Fogg "Tiny Habits" book).

## Principles mapped to design decisions

Status column: **shipped** = already in the app, **FEAT-003** = implemented in the
same change set as the specs, **spec only** = designed but not built.

| Principle | Evidence | What BackUp does | Status |
|---|---|---|---|
| Frequent feedback helps performance now but can hurt learning (guidance effect). Reduced feedback frequency improves retention. | Salmoni, Schmidt & Walter 1984; Winstein & Schmidt 1990 | Praise is faded: first praise at 15 s, then every 1 to 2 minutes. "Light" coaching level swaps voice for a chime on the first reminder of an episode and drops timed praise. It does not reduce the number of reminders. | shipped (faded praise), FEAT-003 (Light level) |
| Measure learning with a no-feedback retention test, not with the coached score. | Salmoni et al. 1984; Winstein & Schmidt 1990 | Silent "Test me" stores a separate score in `store.tests`. Progress view compares it with coached time. | shipped (test), FEAT-003 (view) |
| Feedback can backfire. Cues that point at the task help, cues that point at the self (judgement, shame) tend not to. | Kluger & DeNisi 1996 | Cues name the metric to change ("head forward, tuck your chin"), never the person. No shame wording, no streak-loss messages. | shipped (cues), FEAT-003 (rules written down) |
| Autonomy support and positive feedback raise expectancies and improve learning. | Wulf & Lewthwaite 2016 | Spoken praise is opt-in. Coaching level, mode and mute are user choices. Calibration makes "good" relative to the user's own baseline. | shipped, FEAT-003 (level) |
| Letting the learner decide when to get feedback works, particularly when they decide after the attempt. | Chiviacowsky & Wulf 2005 (and the Down syndrome replication, 2012) | User controls praise, mode and pause. "Test me" is user-initiated. | shipped |
| Positive verbal feedback supports intrinsic motivation. Tangible, expected rewards undermine it. | Deci, Koestner & Ryan 1999 | Praise is verbal and tied to earned behaviour. No points, coins or prizes. Any later leaderboard must not hand out tangible rewards. | shipped, spec only (leaderboard) |
| Support competence, autonomy and relatedness. | Ryan & Deci 2000 | Progress view shows personal improvement, not rank. Social features are opt-in. | FEAT-003 (view), spec only (social) |
| Habits take weeks to months of consistent repetition (average about 66 days, wide range). A missed day does not erase progress. | Lally et al. 2010, as summarised by Gardner, Lally & Wardle 2012 | The progress view uses cumulative minutes and a 7-day window. No broken-streak messages. Copy says "keep going", not "streak lost". | FEAT-003 |
| Gamification effects are mostly positive but context and user dependent. | Hamari, Koivisto & Sarsa 2014 | Light touch only: effort-based milestones, no competitive pressure by default. | FEAT-003 (milestones), spec only (leaderboard) |
| Wearable biofeedback can change sitting posture while it is worn. | Kuo et al. 2021 (21 healthy adults, 1 h typing task) | Real-time feedback is the core mechanism. The study does not show that the effect lasts after the device is removed. | shipped |
| Too many alarms cause desensitisation. | Sendelbach & Funk 2013 (alarm fatigue, clinical setting) | Per-hour reminder cap with a visible "taking a break from reminders" note. Escalation: chime first, voice only after sustained slouch. | FEAT-003 |
| Warning sounds can be designed to convey a chosen level of urgency. | Hellier & Edworthy 1999 (metadata only; title and topic) | Posture reminders are low urgency: moderate volume, short falling two-tone. Positive cue is a rising major arpeggio. | shipped (sounds), FEAT-003 (rules written down) |
| Prompts work when behaviour is easy and a prompt arrives at a moment of ability. | Fogg 2009 (behavior model) | Prompts are brief and tell the user the one thing to change. First-run flow is three short steps. | FEAT-003 |
| Short breaks give small gains in vigor and fatigue. Longer breaks help more. | Albulescu et al. 2022 (meta-analysis, 22 samples, N = 2335) | Optional stand/move microbreak timer. | spec only |
| 20-20-20 reminders reduced digital eye strain symptoms over two weeks, and the benefit faded one week after they stopped. | Talens-Estarelles et al. 2023 (29 symptomatic users) | Optional eye-break reminder. Copy makes no medical claim. | spec only |
| "Perfect" upright posture is not shown to prevent pain. Variety of position and movement matter. | Slater et al. 2019 (viewpoint) | "Relax, don't brace" stance. Shoulder-rise monitor and breath check. Reminders to move, not to hold still. Disclaimer says so. | shipped (relax), FEAT-003 (notice) |
| A Pose model cannot see the jaw. A Face Landmarker can output blendshape scores. | MediaPipe documentation (both pages) | Face tension is a gentle prompt, not a measurement. Needs a second model. | spec only |

## Design rules that follow

1. **Be immediate, specific and about the task.** Name the metric that is off.
2. **Praise only what was earned.** Recovery and sustained good posture qualify.
   Time spent hidden from the camera does not.
3. **Fade feedback.** Early frequent prompts help someone start. Over time, fewer
   prompts and a silent test show whether the skill carried over.
4. **Let the user steer.** Opt-in praise, coaching level, mode, mute, pause.
5. **No punishment.** No harsh sounds, no shaming text, no streak-loss messages.
6. **Cap total prompts per hour** and tell the user when the cap is active.
7. **Do not reward rigidity.** Reward consistency, breaks and relaxed shoulders.
   Milestones count continuous good minutes, so the 30 and 60 minute messages
   prompt a stretch or break, and no streak is kept across milestones.
8. **Say what the evidence cannot say.** See limitations below.

## Limitations of the evidence

- The motor learning studies (Salmoni, Winstein, Wulf, Chiviacowsky) use
  laboratory tasks such as limb positioning and timing. Posture is a continuous,
  everyday behaviour. The transfer is a reasonable inference, not a finding.
- Kluger and DeNisi is a meta-analysis across many kinds of feedback, mostly in
  work and education. Their finding that some feedback reduces performance is
  general. Their numbers were not re-checked here (abstract blocked).
- Deci et al. studied rewards on interest in tasks, mostly with college students and
  children. Verbal praise had the opposite sign to tangible rewards in their data.
- Lally et al. studied simple daily behaviours chosen by volunteers (for example,
  eating fruit or going for a walk). About 66 days is a mean. Individual times varied widely. Posture is
  not a once-daily act.
- Kuo et al. tested 21 young healthy adults for one hour. There is no retention
  result, and that is the outcome that matters here.
- The 20-20-20 trial is small and uncontrolled. Microbreak effects are small
  (d near 0.35).
- Slater et al. is a viewpoint, not a trial. It argues the evidence for "correct
  posture prevents pain" is weak, and does not claim that posture never matters.
- No study here evaluated BackUp. Its detection uses a 2D webcam and
  approximate geometry. **The app is not clinically validated and makes no health
  claims.**

## Sources

Verified (abstract or page text read):

1. Deci, E. L., Koestner, R., & Ryan, R. M. (1999). A meta-analytic review of
   experiments examining the effects of extrinsic rewards on intrinsic motivation.
   *Psychological Bulletin*, 125(6), 627.
   [doi:10.1037/0033-2909.125.6.627](https://doi.org/10.1037/0033-2909.125.6.627).
   128 studies; tangible and expected rewards undermined intrinsic motivation
   (d about -0.28 to -0.40); positive feedback enhanced it (d = 0.33).
2. Ryan, R. M., & Deci, E. L. (2000). Self-determination theory and the
   facilitation of intrinsic motivation, social development, and well-being.
   *American Psychologist*, 55(1), 68.
   [doi:10.1037/0003-066X.55.1.68](https://doi.org/10.1037/0003-066X.55.1.68).
   Competence, autonomy and relatedness as needs behind self-motivation.
3. Wulf, G., & Lewthwaite, R. (2016). Optimizing performance through intrinsic
   motivation and attention for learning: The OPTIMAL theory of motor learning.
   *Psychonomic Bulletin & Review*, 23, 1382-1414.
   [doi:10.3758/s13423-015-0999-9](https://doi.org/10.3758/s13423-015-0999-9).
   Enhanced expectancies, learner autonomy and an external focus improve
   performance and learning.
4. Chiviacowsky, S., & Wulf, G. (2005). Self-controlled feedback is effective if it
   is based on the learner's performance. *Research Quarterly for Exercise and
   Sport*, 76(1), 42-48.
   [doi:10.1080/02701367.2005.10599260](https://doi.org/10.1080/02701367.2005.10599260).
   Learners who chose feedback after a trial showed better delayed transfer.
5. Chiviacowsky, S., Wulf, G., Machado, C., & Rydberg, N. (2012). Self-controlled
   feedback enhances learning in adults with Down syndrome. *Revista Brasileira de
   Fisioterapia*, 16(3), 191-196.
   [doi:10.1590/s1413-35552012005000019](https://doi.org/10.1590/s1413-35552012005000019).
   Self-controlled feedback group retained better on a no-feedback test.
6. Gardner, B., Lally, P., & Wardle, J. (2012). Making health habitual: the
   psychology of 'habit-formation' and general practice. *British Journal of General
   Practice*, 62(605), 664-666.
   [PMC3505409](https://pmc.ncbi.nlm.nih.gov/articles/PMC3505409/) (DOI
   10.3399/bjgp12x659466). Read in full.
   Reports the Lally et al. result: automaticity plateaued after an average of 66
   days, with wide variation, and one missed opportunity did not seriously impair
   habit formation. Used here as the verified route to Lally et al. 2010 (item 14).
7. Kuo, Y.-L., Huang, K.-Y., Kao, C.-Y., & Tsai, Y.-J. (2021). Sitting posture
   during prolonged computer typing with and without a wearable biofeedback sensor.
   *International Journal of Environmental Research and Public Health*, 18(10), 5430.
   [doi:10.3390/ijerph18105430](https://doi.org/10.3390/ijerph18105430).
   With the sensor, neck flexion, thoracic kyphosis and pelvic angles were lower
   during a one-hour task.
8. Slater, D., Korakakis, V., O'Sullivan, P., Nolan, D., & O'Sullivan, K. (2019).
   "Sit up straight": time to re-evaluate. *Journal of Orthopaedic & Sports
   Physical Therapy*, 49(8), 562-564.
   [doi:10.2519/jospt.2019.0610](https://doi.org/10.2519/jospt.2019.0610).
   Beliefs that "incorrect" posture causes spinal pain lack strong evidence.
9. Albulescu, P., et al. (2022). "Give me a break!" A systematic review and
   meta-analysis on the efficacy of micro-breaks for increasing well-being and
   performance. *PLoS ONE*, 17(8), e0272460.
   [doi:10.1371/journal.pone.0272460](https://doi.org/10.1371/journal.pone.0272460).
   Small effects on vigor (d = .36) and fatigue (d = .35); longer breaks helped more.
10. Talens-Estarelles, C., et al. (2023). The effects of breaks on digital eye
    strain, dry eye and binocular vision: Testing the 20-20-20 rule. *Contact Lens
    and Anterior Eye*, 46(2), 101744.
    [doi:10.1016/j.clae.2022.101744](https://doi.org/10.1016/j.clae.2022.101744).
    Reminders reduced eye strain and dry-eye symptoms; the benefit was not
    maintained one week after stopping.
11. Google. MediaPipe Pose Landmarker guide.
    [developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker).
    33 landmarks. The face points are nose, eyes, ears and two mouth corners. There
    is no jaw landmark.
12. Google. MediaPipe Face Landmarker guide.
    [developers.google.com/edge/mediapipe/solutions/vision/face_landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker).
    Outputs face landmarks and blendshape scores (`outputFaceBlendshapes`).
13. US FDA. *General Wellness: Policy for Low Risk Devices* (January 2026 final
    guidance).
    [fda.gov](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/general-wellness-policy-low-risk-devices).
    Describes software for maintaining or encouraging a healthy lifestyle that is
    unrelated to the diagnosis, cure, mitigation, prevention or treatment of a
    disease. Wording of the notice and the app's claims should stay inside that
    framing. Have counsel confirm.

Metadata only (exists as cited; abstract not readable here):

14. Lally, P., van Jaarsveld, C. H. M., Potts, H. W. W., & Wardle, J. (2010). How are
    habits formed: Modelling habit formation in the real world. *European Journal of
    Social Psychology*, 40(6), 998-1009.
    [doi:10.1002/ejsp.674](https://doi.org/10.1002/ejsp.674). Content taken from
    item 6.
15. Salmoni, A. W., Schmidt, R. A., & Walter, C. B. (1984). Knowledge of results and
    motor learning: A review and critical reappraisal. *Psychological Bulletin*,
    95(3), 355-386.
    [doi:10.1037/0033-2909.95.3.355](https://doi.org/10.1037/0033-2909.95.3.355)
    (PMID 6399752). Thesis: knowledge of results guides performance when present
    and can degrade learning if given too often.
16. Winstein, C. J., & Schmidt, R. A. (1990). Reduced frequency of knowledge of
    results enhances motor skill learning. *Journal of Experimental Psychology:
    Learning, Memory, and Cognition*, 16(4), 677.
    [doi:10.1037/0278-7393.16.4.677](https://doi.org/10.1037/0278-7393.16.4.677).
17. Kluger, A. N., & DeNisi, A. (1996). The effects of feedback interventions on
    performance: A historical review, a meta-analysis, and a preliminary feedback
    intervention theory. *Psychological Bulletin*, 119(2), 254.
    [doi:10.1037/0033-2909.119.2.254](https://doi.org/10.1037/0033-2909.119.2.254).
    The claim that roughly a third of feedback interventions lowered performance
    was not re-checked here.
18. Hamari, J., Koivisto, J., & Sarsa, H. (2014). Does gamification work? A
    literature review of empirical studies on gamification. *47th Hawaii
    International Conference on System Sciences*.
    [doi:10.1109/HICSS.2014.377](https://doi.org/10.1109/HICSS.2014.377).
19. Sendelbach, S., & Funk, M. (2013). Alarm fatigue: a patient safety concern.
    *AACN Advanced Critical Care*, 24(4), 378-386.
    [doi:10.4037/nci.0b013e3182a903f9](https://doi.org/10.4037/nci.0b013e3182a903f9).
    Clinical monitors, not posture apps. Used only for the general idea that
    frequent alarms get ignored.
20. Hellier, E., & Edworthy, J. (1999). On using psychophysical techniques to achieve
    urgency mapping in auditory warnings. *Applied Ergonomics*, 30(2), 167-171.
    [doi:10.1016/s0003-6870(97)00013-6](https://doi.org/10.1016/s0003-6870(97)00013-6).
21. Fogg, B. J. (2009). A behavior model for persuasive design. *Proceedings of the
    4th International Conference on Persuasive Technology*.
    [doi:10.1145/1541948.1541999](https://doi.org/10.1145/1541948.1541999).
