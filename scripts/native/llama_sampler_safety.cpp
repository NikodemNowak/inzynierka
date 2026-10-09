#include "rn-completion.h"
#include "rn-llama.h"

#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// Test the installed completion implementation; only the sampler factory and
// unused model/speculative resource boundaries are replaced. No model is loaded.
struct common_sampler {
    bool released = false;
};

namespace {
enum class factory_result { success, exception, empty };
factory_result next_result = factory_result::success;
std::vector<std::unique_ptr<common_sampler>> created;
int releases = 0;
int repeated_releases = 0;

void require(bool condition, const char * message) {
    if (!condition) {
        throw std::runtime_error(message);
    }
}

void reset_tracking() {
    created.clear();
    releases = 0;
    repeated_releases = 0;
    next_result = factory_result::success;
}

void require_balanced() {
    require(repeated_releases == 0, "a sampler was released more than once");
    require(releases == static_cast<int>(created.size()), "a sampler was not released");
}

void expect_factory_exception(rnllama::llama_rn_context_completion & completion) {
    next_result = factory_result::exception;
    try {
        completion.initSampling();
    } catch (const std::runtime_error & error) {
        require(std::string(error.what()) == "test sampler initialization failed",
                "sampler initialization changed the original exception");
        return;
    }
    throw std::runtime_error("sampler initialization did not report the factory exception");
}

void normal_replacement() {
    rnllama::llama_rn_context parent;
    {
        rnllama::llama_rn_context_completion completion(&parent);
        require(completion.initSampling(), "first initialization failed");
        require(completion.initSampling(), "replacement initialization failed");
    }
    require_balanced();
}

void failed_first_initialization() {
    rnllama::llama_rn_context parent;
    {
        rnllama::llama_rn_context_completion completion(&parent);
        expect_factory_exception(completion);
    }
    require_balanced();
}

void failed_replacement_then_teardown() {
    rnllama::llama_rn_context parent;
    {
        rnllama::llama_rn_context_completion completion(&parent);
        require(completion.initSampling(), "first initialization failed");
        expect_factory_exception(completion);
    }
    require_balanced();
}

void failed_replacement_then_retry() {
    rnllama::llama_rn_context parent;
    {
        rnllama::llama_rn_context_completion completion(&parent);
        require(completion.initSampling(), "first initialization failed");
        expect_factory_exception(completion);
        expect_factory_exception(completion);
        next_result = factory_result::success;
        require(completion.initSampling(), "retry initialization failed");
    }
    require_balanced();
}

void empty_replacement_then_teardown() {
    rnllama::llama_rn_context parent;
    {
        rnllama::llama_rn_context_completion completion(&parent);
        require(completion.initSampling(), "first initialization failed");
        next_result = factory_result::empty;
        require(!completion.initSampling(), "empty sampler was accepted");
    }
    require_balanced();
}
} // namespace

common_sampler * common_sampler_init(const llama_model *, common_params_sampling &) {
    if (next_result == factory_result::exception) {
        throw std::runtime_error("test sampler initialization failed");
    }
    if (next_result == factory_result::empty) {
        return nullptr;
    }
    created.push_back(std::make_unique<common_sampler>());
    return created.back().get();
}

void common_sampler_free(common_sampler * sampler) {
    if (sampler == nullptr) {
        return;
    }
    if (sampler->released) {
        ++repeated_releases;
        return;
    }
    sampler->released = true;
    ++releases;
}

// Empty resource boundaries: these tests do not initialize a model or MTP.
void common_speculative_free(common_speculative *) {}
void common_chat_templates_free(common_chat_templates *) {}
struct common_init_result::impl {};
common_init_result::~common_init_result() = default;
void llama_free(llama_context *) {}
void llama_model_free(llama_model *) {}
void llama_adapter_lora_free(llama_adapter_lora *) {}
void llama_batch_free(llama_batch) {}
size_t llama_max_devices() { return 1; }
namespace rnllama {
llama_rn_context::~llama_rn_context() = default;
}

int main() {
    const struct {
        const char * name;
        void (*run)();
    } tests[] = {
        {"normal replacement and teardown", normal_replacement},
        {"failed first initialization and teardown", failed_first_initialization},
        {"failed replacement and teardown", failed_replacement_then_teardown},
        {"failed replacement and retry", failed_replacement_then_retry},
        {"empty replacement and teardown", empty_replacement_then_teardown},
    };
    int failures = 0;
    for (const auto & test : tests) {
        reset_tracking();
        try {
            test.run();
            std::cout << "PASS " << test.name << '\n';
        } catch (const std::exception & error) {
            ++failures;
            std::cout << "FAIL " << test.name << ": " << error.what()
                      << " (created=" << created.size() << ", released=" << releases
                      << ", repeated=" << repeated_releases << ")\n";
        }
    }
    return failures == 0 ? 0 : 1;
}
