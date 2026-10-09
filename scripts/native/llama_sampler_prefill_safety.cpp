#include "sampling.h"
#include "reasoning-budget.h"
#include "log.h"

#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// Safe dependency doubles for the real common_sampler_init/free implementation.
// They track ownership without running inference or releasing memory twice.
struct llama_vocab {};
namespace {
struct sampler_state {
    llama_sampler sampler = {};
    int releases = 0;
    std::vector<llama_sampler *> children;
};
llama_vocab vocabulary;
std::vector<std::unique_ptr<sampler_state>> created;
int accept_count = 0;
int throw_on_accept = 0;

sampler_state & state(llama_sampler * sampler) {
    for (const auto & item : created) {
        if (&item->sampler == sampler) {
            return *item;
        }
    }
    throw std::logic_error("sampler was not created by this test");
}

llama_sampler * make_sampler() {
    created.push_back(std::make_unique<sampler_state>());
    return &created.back()->sampler;
}

void run_case(const char * name, int failure_token) {
    created.clear();
    accept_count = 0;
    throw_on_accept = failure_token;
    common_params_sampling parameters;
    parameters.samplers.clear();
    parameters.grammar = {COMMON_GRAMMAR_TYPE_OUTPUT_FORMAT, "root ::= \"ok\""};
    parameters.generation_prompt = "prefix";

    bool preserved_error = failure_token == 0;
    try {
        common_sampler * sampler = common_sampler_init(nullptr, parameters);
        if (sampler == nullptr) {
            throw std::runtime_error("factory returned no sampler");
        }
        common_sampler_free(sampler);
    } catch (const std::exception & error) {
        preserved_error = dynamic_cast<const std::runtime_error *>(&error) != nullptr
            && std::string(error.what()) == "test grammar prefill failed";
    }
    bool balanced = true;
    for (const auto & item : created) {
        balanced = balanced && item->releases == 1;
    }
    if (!balanced || !preserved_error) {
        std::cout << "FAIL " << name << ": preserved_error=" << preserved_error
                  << ", balanced=" << balanced << ", created=" << created.size()
                  << ", accept_count=" << accept_count << '\n';
        throw std::runtime_error("prefill ownership or exception regression");
    }
    std::cout << "PASS " << name << '\n';
}
} // namespace

const llama_vocab * llama_model_get_vocab(const llama_model *) { return &vocabulary; }
llama_sampler_chain_params llama_sampler_chain_default_params() { return {}; }
llama_sampler * llama_sampler_chain_init(llama_sampler_chain_params) { return make_sampler(); }
void llama_sampler_chain_add(llama_sampler * chain, llama_sampler * sampler) {
    state(chain).children.push_back(sampler);
}
void llama_sampler_accept(llama_sampler *, llama_token) {
    ++accept_count;
    if (accept_count == throw_on_accept) {
        throw std::runtime_error("test grammar prefill failed");
    }
}
void llama_sampler_free(llama_sampler * sampler) {
    if (sampler == nullptr) {
        return;
    }
    auto & item = state(sampler);
    ++item.releases;
    if (item.releases == 1) {
        for (auto * child : item.children) {
            llama_sampler_free(child);
        }
    }
}

std::vector<llama_token> common_tokenize(const llama_vocab *, const std::string &, bool, bool) {
    return {1, 2, 3};
}
std::string common_token_to_piece(const llama_vocab *, llama_token, bool) { return "x"; }
std::string regex_escape(const std::string & value) { return value; }
int32_t llama_vocab_n_tokens(const llama_vocab *) { return 8; }
int32_t llama_model_n_ctx_train(const llama_model *) { return 128; }
void lm_ggml_abort(const char *, int, const char *, ...) {
    throw std::logic_error("unexpected assertion in sampler test");
}
int common_log_get_verbosity_thold() { return -1; }
common_log * common_log_main() { return nullptr; }
void common_log_add(common_log *, lm_ggml_log_level, const char *, ...) {}

#define SAMPLER_DOUBLE(name, arguments) llama_sampler * name arguments { return make_sampler(); }
SAMPLER_DOUBLE(llama_sampler_init_dist, (uint32_t))
SAMPLER_DOUBLE(llama_sampler_init_top_k, (int32_t))
SAMPLER_DOUBLE(llama_sampler_init_top_p, (float, size_t))
SAMPLER_DOUBLE(llama_sampler_init_min_p, (float, size_t))
SAMPLER_DOUBLE(llama_sampler_init_typical, (float, size_t))
SAMPLER_DOUBLE(llama_sampler_init_temp, (float))
SAMPLER_DOUBLE(llama_sampler_init_temp_ext, (float, float, float))
SAMPLER_DOUBLE(llama_sampler_init_xtc, (float, float, size_t, uint32_t))
SAMPLER_DOUBLE(llama_sampler_init_top_n_sigma, (float))
SAMPLER_DOUBLE(llama_sampler_init_mirostat, (int32_t, uint32_t, float, float, int32_t))
SAMPLER_DOUBLE(llama_sampler_init_mirostat_v2, (uint32_t, float, float))
SAMPLER_DOUBLE(llama_sampler_init_grammar, (const llama_vocab *, const char *, const char *))
SAMPLER_DOUBLE(llama_sampler_init_grammar_lazy_patterns,
               (const llama_vocab *, const char *, const char *, const char **, size_t,
                const llama_token *, size_t))
SAMPLER_DOUBLE(llama_sampler_init_penalties, (int32_t, float, float, float))
SAMPLER_DOUBLE(llama_sampler_init_dry,
               (const llama_vocab *, int32_t, float, float, int32_t, int32_t, const char **, size_t))
SAMPLER_DOUBLE(llama_sampler_init_adaptive_p, (float, float, uint32_t))
SAMPLER_DOUBLE(llama_sampler_init_logit_bias, (int32_t, int32_t, const llama_logit_bias *))
SAMPLER_DOUBLE(llama_sampler_init_infill, (const llama_vocab *))
SAMPLER_DOUBLE(common_reasoning_budget_init,
               (const llama_vocab *, const std::vector<llama_token> &, const std::vector<llama_token> &,
                const std::vector<llama_token> &, int32_t, common_reasoning_budget_state))
#undef SAMPLER_DOUBLE

int main() {
    int failures = 0;
    const struct { const char * name; int token; } tests[] = {
        {"successful grammar prefill", 0},
        {"first prefill token failure releases resources and preserves error", 1},
        {"partial prefill failure releases resources and preserves error", 2},
    };
    for (const auto & test : tests) {
        try {
            run_case(test.name, test.token);
        } catch (const std::exception &) {
            ++failures;
        }
    }
    return failures == 0 ? 0 : 1;
}
